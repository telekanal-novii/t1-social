# 🚀 Развёртывание на Oracle Cloud Free Tier + HTTPS

## 1. Создаём сервер на Oracle Cloud

1. Зайди на [cloud.oracle.com](https://cloud.oracle.com) → Sign In → Create Account
2. Выбери **Home Region** (ближайший к тебе, например Frankfurt)
3. Перейди в **Compute → Instances → Create Instance**
4. Выбери:
   - **Image:** Ubuntu 22.04 или 24.04
   - **Shape:** VM.Standard.E2.1.Micro (бесплатно, 1 OCPU, 1GB RAM) или Ampere A1.Flex (4 OCPU, 24GB RAM — ещё лучше)
   - **SSH ключ:** скачай приватный ключ `.pem`
5. **Networking:** оставь VCN и subnet по умолчанию
6. **Create**

## 2. Открываем порт 3000 (и 443 для HTTPS)

1. В Oracle Cloud Console → **Networking → Virtual Cloud Networks** → выбери VCN
2. Кликни на **Subnet** → **Default Security List**
3. **Add Ingress Rules**:
   - Порт `3000`, CIDR `0.0.0.0/0` (или конкретный IP)
   - Порт `443`, CIDR `0.0.0.0/0` (HTTPS)
   - Порт `80`, CIDR `0.0.0.0/0` (для Let's Encrypt)

## 3. Подключаемся к серверу

```bash
# Windows (PowerShell / CMD)
ssh -i путь/к/ключу.pem ubuntu@<PUBLIC_IP>

# Или через PuTTY (конвертируй .pem в .ppk)
```

## 4. Устанавливаем Node.js

```bash
# Обновляем систему
sudo apt update && sudo apt upgrade -y

# Устанавливаем Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Проверяем
node -v  # должен быть v20.x
npm -v
```

## 5. Копируем проект

```bash
# На СВОЁМ компьютере (не на сервере!)
# Упакуй проект без node_modules и database.sqlite
cd "D:\User\Desktop\T1 Сеть"
tar -czf t1-social.tar.gz \
  --exclude=node_modules \
  --exclude=database.sqlite \
  --exclude=test-database.sqlite \
  --exclude=__tests__ \
  .

# Копируем на сервер
scp -i путь/к/ключу.pem t1-social.tar.gz ubuntu@<PUBLIC_IP>:~/
```

## 6. Разворачиваем на сервере

```bash
# На сервере
mkdir -p ~/t1-social
cd ~/t1-social
tar -xzf ~/t1-social.tar.gz

# Устанавливаем зависимости
npm install --production

# Копируем .env
nano .env
# Вставь содержимое .env с правильными ключами

# Тестовый запуск
node server.js
# Если всё ок — Ctrl+C
```

## 7. Запуск как сервис (systemd)

```bash
sudo nano /etc/systemd/system/t1-social.service
```

Вставь:
```ini
[Unit]
Description=T1 Social Network
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/t1-social
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable t1-social
sudo systemctl start t1-social
sudo systemctl status t1-social
```

## 8. HTTPS через Caddy (авто-сертификаты Let's Encrypt)

```bash
# Устанавливаем Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

```bash
sudo nano /etc/caddy/Caddyfile
```

Вставь (замени `your-domain.com` на свой домен или IP):
```
your-domain.com:443 {
    reverse_proxy localhost:3000

    # Security headers
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}

# Если нет домена — используем IP (сертификат не получится, нужен домен)
# Для тестирования без HTTPS можно просто открыть http://IP:3000
```

```bash
sudo systemctl enable caddy
sudo systemctl start caddy
sudo systemctl status caddy
```

**Важно:** Для HTTPS нужен **домен** (даже бесплатный от Freenom/DuckDNS). Без домена Let's Encrypt не выдаст сертификат.

## 9. Без домена (HTTP-only)

Если домена нет — просто открой `http://<PUBLIC_IP>:3000`. Caddy не нужен.

Для базовой безопасности без HTTPS — используй `NODE_ENV=production` и убедись что JWT_SECRET и ENCRYPTION_KEY установлены.

## 10. Проверка

```bash
# Проверь что сервис работает
curl http://localhost:3000/health

# Проверь извне (с другого устройства)
curl https://your-domain.com/health
```

## 🔒 Уровень безопасности

| Без HTTPS | С HTTPS (Caddy) | С E2E шифрованием |
|-----------|-----------------|-------------------|
| Пароли и сообщения летят открытым текстом | Пароли зашифрованы TLS | Сообщения зашифрованы E2E |
| Провайдер видит трафик | Провайдер не видит содержимое | **Даже сервер не может прочитать** |
| БД зашифрована (AES-256) | БД зашифрована + TLS | БД зашифрована + E2E |

**Минимум для друзей:** HTTPS + шифрование БД (уже есть).
**Максимум:** HTTPS + E2E (уже реализовано).
