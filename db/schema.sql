CREATE TABLE users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(191) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    phone VARCHAR(30) NULL,
    avatar_url VARCHAR(500) NULL,
    status ENUM('active','inactive','suspended') NOT NULL DEFAULT 'active',
    last_login_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE businesses (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(191) NOT NULL UNIQUE,
    business_type VARCHAR(50) NULL,
    email VARCHAR(191) NULL,
    phone VARCHAR(30) NULL,
    address TEXT NULL,
    logo_url VARCHAR(500) NULL,
    timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Jakarta',
    currency CHAR(3) NOT NULL DEFAULT 'IDR',
    status ENUM('active','inactive','suspended') NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE roles (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NULL,
    name VARCHAR(50) NOT NULL,
    description VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_roles_business (business_id),

    CONSTRAINT fk_roles_business
        FOREIGN KEY (business_id)
        REFERENCES businesses(id)
        ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE permissions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    module VARCHAR(50) NOT NULL,

    INDEX idx_permissions_module (module)
) ENGINE=InnoDB;

CREATE TABLE role_permissions (
    role_id BIGINT UNSIGNED NOT NULL,
    permission_id BIGINT UNSIGNED NOT NULL,

    PRIMARY KEY (role_id, permission_id),

    CONSTRAINT fk_role_permissions_role
        FOREIGN KEY (role_id)
        REFERENCES roles(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_role_permissions_permission
        FOREIGN KEY (permission_id)
        REFERENCES permissions(id)
        ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE business_users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    role_id BIGINT UNSIGNED NOT NULL,
    status ENUM('active','inactive') NOT NULL DEFAULT 'active',
    joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_business_user (business_id, user_id),
    INDEX idx_business_users_user (user_id),

    CONSTRAINT fk_business_users_business
        FOREIGN KEY (business_id)
        REFERENCES businesses(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_business_users_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_business_users_role
        FOREIGN KEY (role_id)
        REFERENCES roles(id)
        ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE modules (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT NULL,
    icon VARCHAR(100) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

CREATE TABLE business_modules (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NOT NULL,
    module_id BIGINT UNSIGNED NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    settings JSON NULL,
    enabled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_business_module (business_id, module_id),

    CONSTRAINT fk_business_modules_business
        FOREIGN KEY (business_id)
        REFERENCES businesses(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_business_modules_module
        FOREIGN KEY (module_id)
        REFERENCES modules(id)
        ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE units (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NULL,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(50) NOT NULL,
    symbol VARCHAR(20) NULL,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,

    INDEX idx_units_business (business_id),
    UNIQUE KEY uq_units_business_code (business_id, code),

    CONSTRAINT fk_units_business
        FOREIGN KEY (business_id)
        REFERENCES businesses(id)
        ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE item_categories (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NOT NULL,
    parent_id BIGINT UNSIGNED NULL,
    name VARCHAR(100) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_item_categories_business (business_id),
    INDEX idx_item_categories_parent (parent_id),

    CONSTRAINT fk_item_categories_business
        FOREIGN KEY (business_id)
        REFERENCES businesses(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_item_categories_parent
        FOREIGN KEY (parent_id)
        REFERENCES item_categories(id)
        ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE items (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NOT NULL,
    category_id BIGINT UNSIGNED NULL,
    sku VARCHAR(100) NULL,
    name VARCHAR(150) NOT NULL,
    type ENUM('product','service') NOT NULL DEFAULT 'product',
    description TEXT NULL,
    track_stock BOOLEAN NOT NULL DEFAULT FALSE,
    status ENUM('active','inactive') NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at DATETIME NULL,

    INDEX idx_items_business (business_id),
    INDEX idx_items_category (category_id),
    INDEX idx_items_business_status (business_id, status),
    UNIQUE KEY uq_items_business_sku (business_id, sku),

    CONSTRAINT fk_items_business
        FOREIGN KEY (business_id)
        REFERENCES businesses(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_items_category
        FOREIGN KEY (category_id)
        REFERENCES item_categories(id)
        ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE item_variants (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NOT NULL,
    item_id BIGINT UNSIGNED NOT NULL,
    sku VARCHAR(100) NULL,
    name VARCHAR(150) NOT NULL,
    barcode VARCHAR(100) NULL,
    cost_price DECIMAL(15,2) NOT NULL DEFAULT 0,
    stock_quantity DECIMAL(15,3) NOT NULL DEFAULT 0,
    minimum_stock DECIMAL(15,3) NOT NULL DEFAULT 0,
    unit_id BIGINT UNSIGNED NULL,
    status ENUM('active','inactive') NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at DATETIME NULL,

    INDEX idx_variants_business (business_id),
    INDEX idx_variants_item (item_id),
    INDEX idx_variants_barcode (business_id, barcode),
    UNIQUE KEY uq_variants_business_sku (business_id, sku),

    CONSTRAINT fk_variants_business
        FOREIGN KEY (business_id)
        REFERENCES businesses(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_variants_item
        FOREIGN KEY (item_id)
        REFERENCES items(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_variants_unit
        FOREIGN KEY (unit_id)
        REFERENCES units(id)
        ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE item_prices (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NOT NULL,
    item_id BIGINT UNSIGNED NOT NULL,
    variant_id BIGINT UNSIGNED NULL,
    price_type VARCHAR(50) NOT NULL DEFAULT 'retail',
    price DECIMAL(15,2) NOT NULL DEFAULT 0,
    valid_from DATETIME NULL,
    valid_until DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_item_prices_business (business_id),
    INDEX idx_item_prices_item (item_id),
    INDEX idx_item_prices_variant (variant_id),
    INDEX idx_item_prices_type (business_id, price_type),

    CONSTRAINT fk_item_prices_business
        FOREIGN KEY (business_id)
        REFERENCES businesses(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_item_prices_item
        FOREIGN KEY (item_id)
        REFERENCES items(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_item_prices_variant
        FOREIGN KEY (variant_id)
        REFERENCES item_variants(id)
        ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE customers (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NOT NULL,
    code VARCHAR(50) NULL,
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(30) NULL,
    email VARCHAR(191) NULL,
    address TEXT NULL,
    gender VARCHAR(20) NULL,
    birth_date DATE NULL,
    notes TEXT NULL,
    status ENUM('active','inactive') NOT NULL DEFAULT 'active',
    total_spending DECIMAL(15,2) NOT NULL DEFAULT 0,
    last_transaction_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at DATETIME NULL,

    INDEX idx_customers_business (business_id),
    INDEX idx_customers_phone (business_id, phone),
    INDEX idx_customers_email (business_id, email),
    INDEX idx_customers_status (business_id, status),

    CONSTRAINT fk_customers_business
        FOREIGN KEY (business_id)
        REFERENCES businesses(id)
        ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE tags (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(50) NOT NULL,
    color VARCHAR(20) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_tags_business_name (business_id, name),

    CONSTRAINT fk_tags_business
        FOREIGN KEY (business_id)
        REFERENCES businesses(id)
        ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE customer_tags (
    customer_id BIGINT UNSIGNED NOT NULL,
    tag_id BIGINT UNSIGNED NOT NULL,

    PRIMARY KEY (customer_id, tag_id),

    CONSTRAINT fk_customer_tags_customer
        FOREIGN KEY (customer_id)
        REFERENCES customers(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_customer_tags_tag
        FOREIGN KEY (tag_id)
        REFERENCES tags(id)
        ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE sales (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NOT NULL,
    customer_id BIGINT UNSIGNED NULL,
    invoice_number VARCHAR(50) NOT NULL,
    subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
    discount DECIMAL(15,2) NOT NULL DEFAULT 0,
    tax DECIMAL(15,2) NOT NULL DEFAULT 0,
    total DECIMAL(15,2) NOT NULL DEFAULT 0,
    payment_status ENUM('unpaid','partial','paid','refunded') NOT NULL DEFAULT 'unpaid',
    status ENUM('draft','completed','cancelled') NOT NULL DEFAULT 'draft',
    notes TEXT NULL,
    sold_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_sales_invoice (business_id, invoice_number),
    INDEX idx_sales_business_date (business_id, sold_at),
    INDEX idx_sales_customer (business_id, customer_id),
    INDEX idx_sales_status (business_id, status),

    CONSTRAINT fk_sales_business
        FOREIGN KEY (business_id)
        REFERENCES businesses(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_sales_customer
        FOREIGN KEY (customer_id)
        REFERENCES customers(id)
        ON DELETE SET NULL,

    CONSTRAINT fk_sales_creator
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE sale_items (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NOT NULL,
    sale_id BIGINT UNSIGNED NOT NULL,
    item_id BIGINT UNSIGNED NOT NULL,
    variant_id BIGINT UNSIGNED NULL,
    item_name VARCHAR(150) NOT NULL,
    variant_name VARCHAR(150) NULL,
    quantity DECIMAL(15,3) NOT NULL,
    unit_price DECIMAL(15,2) NOT NULL,
    discount DECIMAL(15,2) NOT NULL DEFAULT 0,
    subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,

    INDEX idx_sale_items_business (business_id),
    INDEX idx_sale_items_sale (sale_id),
    INDEX idx_sale_items_item (item_id),

    CONSTRAINT fk_sale_items_business
        FOREIGN KEY (business_id)
        REFERENCES businesses(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_sale_items_sale
        FOREIGN KEY (sale_id)
        REFERENCES sales(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_sale_items_item
        FOREIGN KEY (item_id)
        REFERENCES items(id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_sale_items_variant
        FOREIGN KEY (variant_id)
        REFERENCES item_variants(id)
        ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE payments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NOT NULL,
    sale_id BIGINT UNSIGNED NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    method VARCHAR(30) NOT NULL,
    reference_number VARCHAR(100) NULL,
    status ENUM('pending','paid','failed','refunded') NOT NULL DEFAULT 'paid',
    paid_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_payments_business (business_id),
    INDEX idx_payments_sale (sale_id),
    INDEX idx_payments_date (business_id, paid_at),

    CONSTRAINT fk_payments_business
        FOREIGN KEY (business_id)
        REFERENCES businesses(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_payments_sale
        FOREIGN KEY (sale_id)
        REFERENCES sales(id)
        ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE suppliers (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(30) NULL,
    email VARCHAR(191) NULL,
    address TEXT NULL,
    notes TEXT NULL,
    status ENUM('active','inactive') NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_suppliers_business (business_id),

    CONSTRAINT fk_suppliers_business
        FOREIGN KEY (business_id)
        REFERENCES businesses(id)
        ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE purchases (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NOT NULL,
    supplier_id BIGINT UNSIGNED NULL,
    purchase_number VARCHAR(50) NOT NULL,
    subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
    discount DECIMAL(15,2) NOT NULL DEFAULT 0,
    tax DECIMAL(15,2) NOT NULL DEFAULT 0,
    total DECIMAL(15,2) NOT NULL DEFAULT 0,
    payment_status ENUM('unpaid','partial','paid') NOT NULL DEFAULT 'unpaid',
    status ENUM('draft','received','cancelled') NOT NULL DEFAULT 'draft',
    purchased_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_purchases_number (business_id, purchase_number),
    INDEX idx_purchases_business (business_id),

    CONSTRAINT fk_purchases_business
        FOREIGN KEY (business_id)
        REFERENCES businesses(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_purchases_supplier
        FOREIGN KEY (supplier_id)
        REFERENCES suppliers(id)
        ON DELETE SET NULL,

    CONSTRAINT fk_purchases_creator
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE purchase_items (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NOT NULL,
    purchase_id BIGINT UNSIGNED NOT NULL,
    item_id BIGINT UNSIGNED NOT NULL,
    variant_id BIGINT UNSIGNED NULL,
    item_name VARCHAR(150) NOT NULL,
    quantity DECIMAL(15,3) NOT NULL,
    unit_cost DECIMAL(15,2) NOT NULL,
    subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,

    INDEX idx_purchase_items_business (business_id),
    INDEX idx_purchase_items_purchase (purchase_id),

    CONSTRAINT fk_purchase_items_business
        FOREIGN KEY (business_id)
        REFERENCES businesses(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_purchase_items_purchase
        FOREIGN KEY (purchase_id)
        REFERENCES purchases(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_purchase_items_item
        FOREIGN KEY (item_id)
        REFERENCES items(id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_purchase_items_variant
        FOREIGN KEY (variant_id)
        REFERENCES item_variants(id)
        ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE stock_movements (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NOT NULL,
    item_id BIGINT UNSIGNED NOT NULL,
    variant_id BIGINT UNSIGNED NULL,
    type ENUM('opening','purchase','sale','adjustment','return') NOT NULL,
    quantity DECIMAL(15,3) NOT NULL,
    reference_type VARCHAR(50) NULL,
    reference_id BIGINT UNSIGNED NULL,
    notes TEXT NULL,
    created_by BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_stock_business (business_id),
    INDEX idx_stock_variant (business_id, variant_id),
    INDEX idx_stock_date (business_id, created_at),

    CONSTRAINT fk_stock_business
        FOREIGN KEY (business_id)
        REFERENCES businesses(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_stock_item
        FOREIGN KEY (item_id)
        REFERENCES items(id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_stock_variant
        FOREIGN KEY (variant_id)
        REFERENCES item_variants(id)
        ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE expenses (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NOT NULL,
    category VARCHAR(100) NOT NULL,
    description TEXT NULL,
    amount DECIMAL(15,2) NOT NULL,
    payment_method VARCHAR(30) NULL,
    expense_date DATE NOT NULL,
    created_by BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_expenses_business_date (business_id, expense_date),

    CONSTRAINT fk_expenses_business
        FOREIGN KEY (business_id)
        REFERENCES businesses(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_expenses_creator
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE incomes (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NOT NULL,
    category VARCHAR(100) NOT NULL,
    description TEXT NULL,
    amount DECIMAL(15,2) NOT NULL,
    income_date DATE NOT NULL,
    reference_type VARCHAR(50) NULL,
    reference_id BIGINT UNSIGNED NULL,
    created_by BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_incomes_business_date (business_id, income_date),

    CONSTRAINT fk_incomes_business
        FOREIGN KEY (business_id)
        REFERENCES businesses(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_incomes_creator
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE employees (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NULL,
    employee_code VARCHAR(50) NULL,
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(30) NULL,
    position VARCHAR(100) NULL,
    salary DECIMAL(15,2) NOT NULL DEFAULT 0,
    status ENUM('active','inactive') NOT NULL DEFAULT 'active',
    hired_at DATE NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_employees_business (business_id),
    INDEX idx_employees_user (user_id),

    CONSTRAINT fk_employees_business
        FOREIGN KEY (business_id)
        REFERENCES businesses(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_employees_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE bookings (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NOT NULL,
    customer_id BIGINT UNSIGNED NOT NULL,
    employee_id BIGINT UNSIGNED NULL,
    item_id BIGINT UNSIGNED NOT NULL,
    booking_number VARCHAR(50) NOT NULL,
    start_at DATETIME NOT NULL,
    end_at DATETIME NULL,
    status ENUM('pending','confirmed','completed','cancelled','no_show') NOT NULL DEFAULT 'pending',
    notes TEXT NULL,
    created_by BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_booking_number (business_id, booking_number),
    INDEX idx_bookings_business_date (business_id, start_at),
    INDEX idx_bookings_customer (business_id, customer_id),
    INDEX idx_bookings_employee (business_id, employee_id),

    CONSTRAINT fk_bookings_business
        FOREIGN KEY (business_id)
        REFERENCES businesses(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_bookings_customer
        FOREIGN KEY (customer_id)
        REFERENCES customers(id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_bookings_employee
        FOREIGN KEY (employee_id)
        REFERENCES employees(id)
        ON DELETE SET NULL,

    CONSTRAINT fk_bookings_item
        FOREIGN KEY (item_id)
        REFERENCES items(id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_bookings_creator
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE workflows (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(150) NOT NULL,
    description TEXT NULL,
    status ENUM('draft','active','paused','archived') NOT NULL DEFAULT 'draft',
    trigger_type VARCHAR(50) NOT NULL,
    settings JSON NULL,
    created_by BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_workflows_business (business_id),
    INDEX idx_workflows_status (business_id, status),

    CONSTRAINT fk_workflows_business
        FOREIGN KEY (business_id)
        REFERENCES businesses(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_workflows_creator
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE workflow_triggers (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    workflow_id BIGINT UNSIGNED NOT NULL,
    event_name VARCHAR(100) NOT NULL,
    config JSON NULL,

    INDEX idx_workflow_triggers_event (event_name),

    CONSTRAINT fk_workflow_triggers_workflow
        FOREIGN KEY (workflow_id)
        REFERENCES workflows(id)
        ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE workflow_conditions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    workflow_id BIGINT UNSIGNED NOT NULL,
    field_path VARCHAR(150) NOT NULL,
    operator VARCHAR(30) NOT NULL,
    value TEXT NULL,
    logical_operator VARCHAR(10) NOT NULL DEFAULT 'AND',
    sort_order INT NOT NULL DEFAULT 0,

    INDEX idx_workflow_conditions_workflow (workflow_id),

    CONSTRAINT fk_workflow_conditions_workflow
        FOREIGN KEY (workflow_id)
        REFERENCES workflows(id)
        ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE workflow_actions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    workflow_id BIGINT UNSIGNED NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    config JSON NULL,
    sort_order INT NOT NULL DEFAULT 0,
    delay_seconds INT NOT NULL DEFAULT 0,
    status ENUM('active','inactive') NOT NULL DEFAULT 'active',

    INDEX idx_workflow_actions_workflow (workflow_id),

    CONSTRAINT fk_workflow_actions_workflow
        FOREIGN KEY (workflow_id)
        REFERENCES workflows(id)
        ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE automation_runs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NOT NULL,
    workflow_id BIGINT UNSIGNED NOT NULL,
    trigger_event VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NULL,
    entity_id BIGINT UNSIGNED NULL,
    status ENUM('queued','running','completed','failed','cancelled') NOT NULL DEFAULT 'queued',
    started_at DATETIME NULL,
    completed_at DATETIME NULL,
    error_message TEXT NULL,

    INDEX idx_automation_runs_business (business_id),
    INDEX idx_automation_runs_workflow (business_id, workflow_id),
    INDEX idx_automation_runs_status (business_id, status),

    CONSTRAINT fk_automation_runs_business
        FOREIGN KEY (business_id)
        REFERENCES businesses(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_automation_runs_workflow
        FOREIGN KEY (workflow_id)
        REFERENCES workflows(id)
        ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE automation_logs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NOT NULL,
    automation_run_id BIGINT UNSIGNED NOT NULL,
    action_id BIGINT UNSIGNED NULL,
    status ENUM('success','failed','skipped') NOT NULL,
    message TEXT NULL,
    input_data JSON NULL,
    output_data JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_automation_logs_business (business_id),
    INDEX idx_automation_logs_run (automation_run_id),

    CONSTRAINT fk_automation_logs_business
        FOREIGN KEY (business_id)
        REFERENCES businesses(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_automation_logs_run
        FOREIGN KEY (automation_run_id)
        REFERENCES automation_runs(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_automation_logs_action
        FOREIGN KEY (action_id)
        REFERENCES workflow_actions(id)
        ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE plans (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    price_monthly DECIMAL(15,2) NOT NULL DEFAULT 0,
    price_yearly DECIMAL(15,2) NOT NULL DEFAULT 0,
    max_users INT NULL,
    max_customers INT NULL,
    max_items INT NULL,
    max_automations INT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE plan_modules (
    plan_id BIGINT UNSIGNED NOT NULL,
    module_id BIGINT UNSIGNED NOT NULL,

    PRIMARY KEY (plan_id, module_id),

    CONSTRAINT fk_plan_modules_plan
        FOREIGN KEY (plan_id)
        REFERENCES plans(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_plan_modules_module
        FOREIGN KEY (module_id)
        REFERENCES modules(id)
        ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE subscriptions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NOT NULL,
    plan_id BIGINT UNSIGNED NOT NULL,
    status ENUM('trial','active','past_due','cancelled','expired') NOT NULL DEFAULT 'trial',
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    current_period_start DATETIME NOT NULL,
    current_period_end DATETIME NOT NULL,
    trial_ends_at DATETIME NULL,
    cancelled_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_subscriptions_business (business_id),
    INDEX idx_subscriptions_status (business_id, status),

    CONSTRAINT fk_subscriptions_business
        FOREIGN KEY (business_id)
        REFERENCES businesses(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_subscriptions_plan
        FOREIGN KEY (plan_id)
        REFERENCES plans(id)
        ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE audit_logs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NULL,
    entity_id BIGINT UNSIGNED NULL,
    old_data JSON NULL,
    new_data JSON NULL,
    ip_address VARCHAR(45) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_audit_business (business_id),
    INDEX idx_audit_entity (business_id, entity_type, entity_id),
    INDEX idx_audit_date (business_id, created_at),

    CONSTRAINT fk_audit_business
        FOREIGN KEY (business_id)
        REFERENCES businesses(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_audit_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE SET NULL
) ENGINE=InnoDB;

INSERT INTO modules
(code, name, description, is_active)
VALUES
('customer', 'Customer', 'Mengelola data pelanggan', TRUE),
('sales', 'Sales', 'Mengelola penjualan', TRUE),
('items', 'Products & Services', 'Mengelola produk dan jasa', TRUE),
('inventory', 'Inventory', 'Mengelola stok', TRUE),
('purchase', 'Purchase', 'Mengelola pembelian', TRUE),
('finance', 'Finance', 'Mengelola pemasukan dan pengeluaran', TRUE),
('booking', 'Booking', 'Mengelola reservasi', TRUE),
('employee', 'Employee', 'Mengelola karyawan', TRUE),
('marketing', 'Marketing', 'Mengelola marketing', TRUE),
('automation', 'Automation', 'Mengotomatisasi proses bisnis', TRUE);

INSERT INTO plans
(code, name, price_monthly, price_yearly, max_users, max_customers, max_items, max_automations)
VALUES
('starter', 'Starter', 49000, 490000, 2, 500, 100, 5),
('business', 'Business', 99000, 990000, 5, 5000, 1000, 25),
('pro', 'Pro', 199000, 1990000, 15, NULL, NULL, NULL);
