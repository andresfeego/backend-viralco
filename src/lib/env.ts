export const env = {
  port: Number(process.env.PORT || 4000),
  accessTokenSecret: process.env.ACCESS_TOKEN_SECRET || 'viralco_access_secret_dev',
  refreshTokenSecret: process.env.REFRESH_TOKEN_SECRET || 'viralco_refresh_secret_dev',
  superAdminConfirmSecret:
    process.env.SUPER_ADMIN_CONFIRM_SECRET || 'viralco_super_admin_confirm_secret_dev',
  superAdminConfirmPassword:
    process.env.SUPER_ADMIN_CONFIRM_PASSWORD || 'ViralCo_Master_Confirm_2026!',
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '15m',
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30),
  superAdminConfirmTtl: process.env.SUPER_ADMIN_CONFIRM_TTL || '10m',
  passwordResetTtlMinutes: Number(process.env.PASSWORD_RESET_TTL_MINUTES || 30),
};
