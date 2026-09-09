function notFoundHandler(req, res, next) {
  res.status(404).render('error', {
    title: 'Nie znaleziono strony',
    statusCode: 404,
    message: 'Strona, której szukasz, nie istnieje.',
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error(err);
  const statusCode = err.status || 500;
  res.status(statusCode).render('error', {
    title: 'Coś poszło nie tak',
    statusCode,
    message:
      process.env.NODE_ENV === 'production'
        ? 'Wystąpił błąd serwera. Spróbuj ponownie później.'
        : err.message,
  });
}

module.exports = { notFoundHandler, errorHandler };
