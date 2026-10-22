-- Keamanan akun: verifikasi email, reset password, pencabutan token lama. Aman dijalankan berulang.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at DATETIME NULL AFTER email;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at DATETIME NULL AFTER password_hash;

-- Akun yang sudah ada sebelum fitur ini (masa uji coba) dianggap terverifikasi.
UPDATE users SET email_verified_at = created_at
 WHERE email_verified_at IS NULL AND created_at < '2026-10-23 00:00:00';

CREATE TABLE IF NOT EXISTS auth_tokens (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    type ENUM('verify_email','reset_password') NOT NULL,
    token_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_auth_tokens_hash (token_hash),
    INDEX idx_auth_tokens_user (user_id, type),

    CONSTRAINT fk_auth_tokens_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
