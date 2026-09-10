const nodemailer = require('nodemailer');

// Konfiguracja pod Gmail
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/**
 * Wysyła prawdziwy e-mail z linkiem do resetowania hasła.
 */
async function sendPasswordResetEmail(toEmail, resetToken) {
  // Link lokalny kierujący na Twój serwer na localhost
  const resetLink = `http://localhost:3000/auth/reset-password/${resetToken}`;

  // Link lokalny kierujący na Twój serwer na azure
  //const resetLink = `https://gameverse-arfgc3cfbvd5crd5.polandcentral-01.azurewebsites.net/auth/reset-password/${resetToken}`;

  const mailOptions = {
    from: `"GameVerse" <${process.env.EMAIL_USER}>`,
    to: toEmail, // Prawdziwy odbiorca
    subject: 'Resetowanie hasła do Twojego konta',
    html: `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
        <h2 style="color: #333;">Resetowanie hasła</h2>
        <p>Otrzymaliśmy prośbę o zresetowanie hasła.</p>
        <p>Kliknij poniższy przycisk, aby ustawić nowe hasło (link jest aktywny przez 15 minut):</p>
        <p style="text-align: center; margin: 30px 0;">
          <a href="${resetLink}" style="background-color: #5c67f2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
            Zresetuj hasło
          </a>
        </p>
        <p style="color: #777; font-size: 12px;">Jeśli to nie Ty zgłaszałeś tę prośbę, zignoruj tę wiadomość.</p>
      </div>
    `,
  };

  return await transporter.sendMail(mailOptions);
}

module.exports = {
  sendPasswordResetEmail,
};