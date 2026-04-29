export async function sendResetPasswordMailSimulated(email: string, rawToken: string) {
  const lines = [
    '--- SMTP SIMULADO ---',
    `to=${email}`,
    'subject=Recuperacion de contrasena ViralCo',
    `body=Usa este token para resetear tu contrasena: ${rawToken}`,
    '--- FIN SMTP SIMULADO ---',
  ];

  for (const line of lines) {
    console.log(line);
  }
}
