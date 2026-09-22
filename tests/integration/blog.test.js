const request = require('supertest');
const { createTestApp } = require('../setup/testApp');
const { createBlogPost, csrfToken, userAgent, adminAgent } = require('../setup/factories');

describe('blog', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  test('lista bloga pokazuje opublikowane wpisy, ale nie szkice', async () => {
    await createBlogPost({ title: 'Wpis opublikowany', status: 'published' });
    await createBlogPost({ title: 'Wpis szkic', status: 'draft' });

    const res = await request(ctx.app).get('/blog');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Wpis opublikowany');
    expect(res.text).not.toContain('Wpis szkic');
  });

  test('szkic jest niewidoczny dla gościa (404), ale widoczny dla administratora', async () => {
    const post = await createBlogPost({ title: 'Ukryty szkic', status: 'draft' });

    const guest = await request(ctx.app).get(`/blog/${post.id}`);
    expect(guest.status).toBe(404);

    const { agent } = await adminAgent(ctx.app);
    const admin = await agent.get(`/blog/${post.id}`);
    expect(admin.status).toBe(200);
    expect(admin.text).toContain('Ukryty szkic');
  });

  test('wpis zaplanowany na przyszłość nie jest jeszcze widoczny publicznie', async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const post = await createBlogPost({ title: 'Wpis z przyszłości', status: 'published', publishAt: future });

    const list = await request(ctx.app).get('/blog');
    expect(list.text).not.toContain('Wpis z przyszłości');
    const detail = await request(ctx.app).get(`/blog/${post.id}`);
    expect(detail.status).toBe(404);
  });

  test('zwykły użytkownik nie może utworzyć wpisu (brak uprawnień admina)', async () => {
    const { agent } = await userAgent(ctx.app);
    const token = await csrfToken(agent, '/blog');
    const res = await agent.post('/blog/new').send({
      title: 'Próba zwykłego użytkownika', content: 'Treść wpisu, wystarczająco długa, żeby przeszła walidację.',
      category: 'Aktualności', tags: 'test', publishMode: 'now', _csrf: token,
    });
    expect(res.status).toBe(302);

    const all = await request(ctx.app).get('/blog');
    expect(all.text).not.toContain('Próba zwykłego użytkownika');
  });

  test('administrator tworzy, edytuje i usuwa wpis', async () => {
    const { agent } = await adminAgent(ctx.app);
    let token = await csrfToken(agent, '/blog/new');
    const create = await agent.post('/blog/new').send({
      title: 'Wpis administratora', content: 'Treść nowego wpisu, wystarczająco długa, żeby przeszła walidację formularza.',
      category: 'Poradniki', tags: 'rpg, poradnik', publishMode: 'now', excerpt: '', autoCoverPresent: '1', coverVariant: '0', _csrf: token,
    });
    expect(create.status).toBe(302);
    const id = create.headers.location.split('/').pop();

    const detail = await agent.get(`/blog/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.text).toContain('Wpis administratora');

    token = await csrfToken(agent, `/blog/${id}/edit`);
    const edit = await agent.post(`/blog/${id}/edit`).send({
      title: 'Wpis administratora (po edycji)', content: 'Zmieniona treść wpisu, także wystarczająco długa do walidacji.',
      category: 'Poradniki', tags: 'rpg', publishMode: 'now', excerpt: '', autoCoverPresent: '1', coverVariant: '0', _csrf: token,
    });
    expect(edit.status).toBe(302);
    const afterEdit = await agent.get(`/blog/${id}`);
    expect(afterEdit.text).toContain('Wpis administratora (po edycji)');

    token = await csrfToken(agent, `/blog/${id}`);
    const del = await agent.post(`/blog/${id}/delete`).send({ _csrf: token });
    expect(del.status).toBe(302);
    expect((await request(ctx.app).get(`/blog/${id}`)).status).toBe(404);
  });

  test('wpis bez tytułu albo treści jest odrzucany', async () => {
    const { agent } = await adminAgent(ctx.app);
    const token = await csrfToken(agent, '/blog/new');
    const res = await agent.post('/blog/new').send({ title: '', content: '', category: 'Aktualności', publishMode: 'now', _csrf: token });
    expect(res.status).toBe(400);
  });

  test('filtr po tagu pokazuje tylko wpisy z tym tagiem', async () => {
    await createBlogPost({ title: 'Wpis z tagiem RPG', tags: ['rpg', 'poradnik'] });
    await createBlogPost({ title: 'Wpis bez tego tagu', tags: ['inne'] });

    const res = await request(ctx.app).get('/blog?tag=rpg');
    expect(res.text).toContain('Wpis z tagiem RPG');
    expect(res.text).not.toContain('Wpis bez tego tagu');
  });

  test('zalogowany użytkownik dodaje komentarz pod wpisem', async () => {
    const post = await createBlogPost({ title: 'Wpis z komentarzem' });
    const { agent } = await userAgent(ctx.app, { username: 'komentator' });
    const token = await csrfToken(agent, `/blog/${post.id}`);
    const res = await agent.post(`/blog/${post.id}/comments`).send({ text: 'Świetny wpis, dziękuję za poradnik!', _csrf: token });
    expect(res.status).toBe(302);

    const page = await request(ctx.app).get(`/blog/${post.id}`);
    expect(page.text).toContain('Świetny wpis');
    expect(page.text).toContain('komentator');
  });

  test('gość nie może dodać komentarza', async () => {
    const post = await createBlogPost({ title: 'Wpis bez komentarza gościa' });
    const res = await request(ctx.app).post(`/blog/${post.id}/comments`).redirects(0);
    expect(res.status).toBe(302);
    const BlogComment = require('../../models/BlogComment');
    expect(await BlogComment.count({ where: { postId: post.id } })).toBe(0);
  });

  test('autor komentarza może go usunąć, ale inny użytkownik - nie', async () => {
    const post = await createBlogPost({ title: 'Wpis do testu usuwania komentarzy' });
    const { agent: author } = await userAgent(ctx.app, { username: 'autorkomentarza' });
    let token = await csrfToken(author, `/blog/${post.id}`);
    await author.post(`/blog/${post.id}/comments`).send({ text: 'Komentarz do usunięcia przez autora.', _csrf: token });

    const BlogComment = require('../../models/BlogComment');
    const comment = await BlogComment.findOne({ where: { postId: post.id } });

    const { agent: intruder } = await userAgent(ctx.app, { username: 'intruzkomentarz' });
    token = await csrfToken(intruder, `/blog/${post.id}`);
    await intruder.post(`/blog/${post.id}/comments/${comment.id}/delete`).send({ _csrf: token });
    expect(await BlogComment.findByPk(comment.id)).not.toBeNull();

    token = await csrfToken(author, `/blog/${post.id}`);
    await author.post(`/blog/${post.id}/comments/${comment.id}/delete`).send({ _csrf: token });
    expect(await BlogComment.findByPk(comment.id)).toBeNull();
  });

  test('usunięcie wpisu usuwa też jego komentarze', async () => {
    const post = await createBlogPost({ title: 'Wpis z komentarzami do skasowania' });
    const { agent: commenter } = await userAgent(ctx.app, { username: 'ktokolwiek' });
    let token = await csrfToken(commenter, `/blog/${post.id}`);
    await commenter.post(`/blog/${post.id}/comments`).send({ text: 'Komentarz, który zniknie razem z wpisem.', _csrf: token });

    const { agent: admin } = await adminAgent(ctx.app);
    token = await csrfToken(admin, `/blog/${post.id}`);
    await admin.post(`/blog/${post.id}/delete`).send({ _csrf: token });

    const BlogComment = require('../../models/BlogComment');
    expect(await BlogComment.count({ where: { postId: post.id } })).toBe(0);
  });

  test('/blog/:id.md zwraca czysty Markdown tylko dla opublikowanych wpisów', async () => {
    const post = await createBlogPost({ title: 'Wpis w Markdownie', status: 'published' });
    const md = await request(ctx.app).get(`/blog/${post.id}.md`);
    expect(md.status).toBe(200);
    expect(md.text).toContain('# Wpis w Markdownie');

    const draft = await createBlogPost({ title: 'Szkic bez Markdownu', status: 'draft' });
    const mdDraft = await request(ctx.app).get(`/blog/${draft.id}.md`);
    expect(mdDraft.status).toBe(404);
  });
});
