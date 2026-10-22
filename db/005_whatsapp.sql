-- WhatsApp (Baileys): sesi per bisnis + antrean/riwayat pesan. Aman dijalankan berulang.
INSERT INTO modules (code, name, description, is_active)
SELECT 'whatsapp', 'WhatsApp', 'Kirim struk & pesan otomatis ke pelanggan lewat WhatsApp', 1 FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM modules WHERE code = 'whatsapp');

CREATE TABLE IF NOT EXISTS whatsapp_sessions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NOT NULL,
    status ENUM('disconnected','connecting','qr','connected','logged_out') NOT NULL DEFAULT 'disconnected',
    phone VARCHAR(30) NULL,
    daily_limit INT UNSIGNED NOT NULL DEFAULT 30,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_wa_sessions_business (business_id),
    CONSTRAINT fk_wa_sessions_business
        FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NOT NULL,
    to_phone VARCHAR(20) NOT NULL,
    body TEXT NOT NULL,
    status ENUM('queued','sending','sent','failed') NOT NULL DEFAULT 'queued',
    attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    error VARCHAR(255) NULL,
    source VARCHAR(30) NOT NULL DEFAULT 'automation',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at DATETIME NULL,

    INDEX idx_wa_msg_queue (business_id, status, id),
    INDEX idx_wa_msg_created (business_id, created_at),
    CONSTRAINT fk_wa_msg_business
        FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB;
