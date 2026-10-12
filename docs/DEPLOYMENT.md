# Деплой и режим раздачи (serving mode)

Как собрать, выложить и переключать источники интерфейса между CDN-зеркалом и
собственным сервером, а также серверная сетевая гигиена (Cloudflare, BBR, MTU).

## 1. Режим раздачи бандла

В `shell-config.js` есть поле `mode`, которое загрузчик читает на лету:

| Режим            | Основной источник       | Когда нужен                                             |
| ---------------- | ----------------------- | ------------------------------------------------------- |
| `mirror` (Default) | CDN-зеркало jsDelivr  | Хостинг **вне РФ** (наш Oracle Amsterdam): same-origin большой ответ отдаётся по капле, зеркало на другом домене доезжает целиком |
| `origin`         | сам хостинг (PHP-ассет, затем статика) | Сервер **в РФ**: origin быстрый, CDN-зеркало больше не нужно (и внешний трафик не гоняем) |
| `auto`           | `mirror`, если заданы зеркала, иначе `origin` | Универсальный дефолт для сборки, которая едет на любой сервер |

Порядок цепочек в каждом режиме:

- `mirror`: `localStorage → CDN-зеркало (+прокси) → PHP-ассет/статика → Range-куски → fetch+инлайн`;
- `origin`: `localStorage → PHP-ассет/статика → Range-куски → CDN-зеркало (+прокси) → fetch+инлайн`.

`MIRRORS.mode` (в `shell-config.js`) приоритетнее `CONFIG.mode` (значение из сборки),
поэтому режим можно менять **на сервере без пересборки** (см. §3).

### Сборка под нужный режим

```bash
SERVE_MODE=origin npm run build:shell   # по умолчанию mirror
```

`SERVE_MODE` влияет только на собранный `shell-config.js`/`index.html`; исходники
едины для всех режимов.

## 2. Скрипт `serving-mode`

`scripts/serving-mode` — серверная утилита: правит поле `mode` в задеплоенных
`shell-config.js` (без пересборки) и, при желании, включает/выключает проксирование
Cloudflare. По умолчанию работает в режиме **dry-run** — только печатает план.

Установка на сервере:

```bash
sudo install -m 0755 scripts/serving-mode /usr/local/bin/serving-mode
```

Примеры:

```bash
# что изменится (ничего не трогаем):
serving-mode origin

# применить ко всем проектам в /var/www/html/project:
sudo serving-mode --apply origin

# только к одному проекту:
sudo serving-mode --apply mirror vk-photo-api

# включить/выключить Cloudflare-прокси для manjaro.yjjx.org:
sudo CF_API_TOKEN=... serving-mode --apply --cf on
sudo CF_API_TOKEN=... serving-mode --apply --cf off
```

Состояние режима пишется в `<root>/.serving-mode` (по умолчанию
`/var/www/html/project/.serving-mode`). Ключи: `--root DIR`, `--record HOST`,
`--zone ZONE`.

## 3. Проксирование Cloudflare

`manjaro.yjjx.org` — A-запись на наш IP (`141.144.207.160`), зона `yjjx.org`
обслуживается в Cloudflare. Сейчас запись **серая** (DNS-only). Включение оранжевого
облака (`proxied=true`) заводит трафик через сеть Cloudflare и скрывает origin.

Токен для `--cf` создаётся в Cloudflare → My Profile → API Tokens → шаблон
**Edit zone DNS**: права `Zone → DNS → Edit` для зоны `yjjx.org`. Передавайте его
только через окружение (`CF_API_TOKEN`), в файлы не пишите.

После включения прокси Apache видит IP узлов Cloudflare, а не клиента — обязательно
настройте `mod_remoteip` (§4), иначе логи и диагностика теряют реальные адреса.

## 4. Реальный IP клиента за Cloudflare (`mod_remoteip`)

```bash
sudo a2enmod remoteip
```

В vhost (`/etc/apache2/sites-available/000-default.conf` и `default-ssl.conf`) внутри
`<VirtualHost>` добавьте:

```apache
RemoteIPHeader CF-Connecting-IP
RemoteIPTrustedProxy 173.245.48.0/20
RemoteIPTrustedProxy 103.21.244.0/22
RemoteIPTrustedProxy 103.22.200.0/22
RemoteIPTrustedProxy 103.31.4.0/22
RemoteIPTrustedProxy 141.101.64.0/18
RemoteIPTrustedProxy 108.162.192.0/18
RemoteIPTrustedProxy 190.93.240.0/20
RemoteIPTrustedProxy 188.114.96.0/20
RemoteIPTrustedProxy 197.234.240.0/22
RemoteIPTrustedProxy 198.41.128.0/17
RemoteIPTrustedProxy 162.158.0.0/15
RemoteIPTrustedProxy 104.16.0.0/13
RemoteIPTrustedProxy 104.24.0.0/14
RemoteIPTrustedProxy 172.64.0.0/13
RemoteIPTrustedProxy 131.0.72.0/22
RemoteIPTrustedProxy 2400:cb00::/32
RemoteIPTrustedProxy 2606:4700::/32
RemoteIPTrustedProxy 2803:f800::/32
RemoteIPTrustedProxy 2405:b500::/32
RemoteIPTrustedProxy 2405:8100::/32
RemoteIPTrustedProxy 2a06:98c0::/29
RemoteIPTrustedProxy 2c0f:f248::/32
```

Актуальный список — <https://www.cloudflare.com/ips/>. В формате лога `combined`
`%h` автоматически заменяется на восстановленный адрес. Проверьте конфиг:

```bash
sudo apache2ctl configtest && sudo systemctl reload apache2
```

## 5. Сетевая гигиена сервера (BBR, fq, MTU)

Симптом: curl с сервера быстрый, `check-host.net` подтверждает TCP:443 и отдачу
218 КБ десяткам узлов мира за <1 c, но у части потребительских маршрутов РФ (через
транзит GTT AS3257 → Rostelecom AS12389) — потери до 36% и «окно схлопывается»
(`cwnd:1`, `rto:37248`, `backoff:7`). Это транзит, не сервер и не код; но смягчить
помогают современное управление перегрузкой и корректный MTU.

### BBR + fq

Модуль есть (`/lib/modules/$(uname -r)/kernel/net/ipv4/tcp_bbr.ko.zst`), но не
загружен (`tcp_available_congestion_control = reno cubic`).

```bash
echo tcp_bbr | sudo tee /etc/modules-load.d/tcp_bbr.conf
sudo modprobe tcp_bbr

sudo tee /etc/sysctl.d/99-net-tune.conf >/dev/null <<'EOF'
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
net.ipv4.tcp_mtu_probing = 1
EOF
sudo sysctl --system
```

Проверка: `sysctl net.ipv4.tcp_congestion_control net.core.default_qdisc` →
`bbr` и `fq`.

### MTU

Oracle-образец ставит на `ens3` jumbo `mtu 9000` (`/etc/netplan/50-cloud-init.yaml`).
Для внешних потребительских маршрутов jumbo бесполезен и вредит: PMTU-discovery
блокируется, крупные сегменты «чёрно-дырятся». Ставим 1500.

```bash
sudo sed -i 's/^\s*mtu: 9000/mtu: 1500/' /etc/netplan/50-cloud-init.yaml
sudo netplan try    # проверьте доступность; при отсутствии подтверждения откатится
sudo netplan apply
ip link show ens3 | grep -o 'mtu [0-9]*'
```

Если cloud-init перегенерирует netplan, зафиксируйте значение также через
`/etc/cloud/cloud.cfg.d/99-disable-network-config.cfg`:

```bash
echo 'network: {config: disabled}' | sudo tee /etc/cloud/cloud.cfg.d/99-disable-network-config.cfg
```

`tcp_mtu_probing = 1` из §5 дополняет это: ядро само ищет рабочий MTU, если
PMTU-подтверждения не приходят.

## 6. Выкладка проекта

1. `npm install && npm run build`.
2. Закоммитить и запушить `index.html`, `shell-config.js`, `assets/app-*.js|css`
   (jsDelivr-зеркала отдают файлы из git).
3. Скопировать артефакты в `/var/www/html/project/vk-photo-api` (`api.php`, `sw.js`,
   `site.webmanifest`, иконки, `.htaccess`, `private/`).
4. Права: `private/` и подкаталоги (`cache/`, `ai-cache/`, `diag/`) — на запись
   пользователю веб-сервера (`www-data`), `secrets.php` — `0600`.
5. При переезде на сервер в РФ — переключить режим: `sudo serving-mode --apply origin`.

## 7. Проверка после деплоя

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://manjaro.yjjx.org/project/vk-photo-api/
curl -s https://manjaro.yjjx.org/project/vk-photo-api/shell-config.js | grep mode
sysctl net.ipv4.tcp_congestion_control net.core.default_qdisc net.ipv4.tcp_mtu_probing
ip link show ens3 | grep -o 'mtu [0-9]*'
```

В браузере лог загрузчика (`web/shell-runtime.js`) печатает выбранный режим и
источник основного бандла.
