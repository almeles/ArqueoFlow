# ArqueoFlow

> **Bot de Telegram para Arqueo de Caja** — gestión multidivisa, rutas asignables y reportes tipo ticket, todo desde tu chat.

---

## ⚡ Instalación en un solo comando

```bash
wget -O arqueoflow.sh https://raw.githubusercontent.com/almeles/ArqueoFlow/main/arqueoflow.sh && chmod +x arqueoflow.sh && ./arqueoflow.sh
```

El script interactivo se encargará de todo:

1. Actualiza `apt` e instala dependencias del sistema (`curl`, `git`, `wget`).
2. Verifica Node.js ≥ 18; lo instala vía NodeSource si hace falta.
3. Clona el repositorio (o actualiza / reinstala si ya existe).
4. Ejecuta `npm install`.
5. Te solicita `TELEGRAM_BOT_TOKEN` y `ADMIN_ID` para generar el archivo `.env`.
6. Instala y configura **PM2** para que el bot arranque automáticamente.
7. Valida que el proceso esté *online* y muestra el `@username` del bot.

---

## 🖥️ Comandos para VPS (paso a paso)

Si prefieres ejecutar cada paso manualmente en tu servidor, sigue esta secuencia:

### 1. Preparar el sistema

```bash
sudo apt-get update -y && sudo apt-get install -y curl git wget
```

### 2. Instalar Node.js 18+

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # debe mostrar v18.x.x o superior
```

### 3. Clonar el repositorio

```bash
git clone https://github.com/almeles/ArqueoFlow.git
cd ArqueoFlow
```

### 4. Instalar dependencias

```bash
npm install
```

### 5. Crear el archivo de configuración `.env`

```bash
cat > .env << 'EOF'
TELEGRAM_BOT_TOKEN=tu_token_aqui
ADMIN_ID=tu_id_numerico
TIMEZONE=America/Managua
DB_PATH=./arqueo.db
EOF
```

> Obtén tu token con [@BotFather](https://t.me/BotFather) y tu ID numérico con [@userinfobot](https://t.me/userinfobot).

### 6. Instalar PM2 y arrancar el bot

```bash
sudo npm install -g pm2
pm2 start src/index.js --name arqueoflow
pm2 save
pm2 startup          # copia y ejecuta el comando que imprima
```

### 7. Verificar que el bot está en línea

```bash
pm2 status
pm2 logs arqueoflow --lines 50
```

---

## 🔄 Actualizar el bot en el VPS

```bash
cd ArqueoFlow
git pull --ff-only
npm install
pm2 restart arqueoflow
```

---

## ✨ Características

| Función | Descripción |
|---|---|
| **Rutas Predefinidas y Asignables** | Define rutas fijas o asígnalas dinámicamente a cada cobrador. |
| **Arqueo Multidivisa (USD → NIO)** | Conversión automática de dólares a córdobas al tipo de cambio configurado. |
| **Soporte de Moneda Fraccionaria** | Maneja billetes y monedas fraccionarias (0.10, 0.25, etc.). |
| **Devoluciones Simplificadas** | Registro de devoluciones con conteo y monto total separados. |
| **Reportes tipo "Ticket de Caja"** | Genera reportes formateados listos para imprimir o compartir. |
| **Panel de Administración** | Aprobación de usuarios, liquidación de rutas y exportación a CSV. |
| **Persistencia de Datos (SQLite)** | Toda la información se almacena localmente en una base de datos SQLite. |

---

## ⚙️ Configuración manual (`.env`)

Si prefieres configurar el bot a mano, crea un archivo `.env` en la raíz del proyecto:

```env
TELEGRAM_BOT_TOKEN=tu_token_aqui
ADMIN_ID=tu_id_numerico
TIMEZONE=America/Managua
DB_PATH=./arqueo.db
```

---

## 🛠️ Gestión del proceso con PM2

```bash
pm2 status                        # Ver estado de todos los procesos
pm2 logs arqueoflow               # Ver logs en tiempo real
pm2 logs arqueoflow --lines 100   # Ver las últimas 100 líneas de logs
pm2 restart arqueoflow            # Reiniciar el bot
pm2 stop arqueoflow               # Detener el bot
pm2 start arqueoflow              # Iniciar el bot (si fue detenido)
pm2 delete arqueoflow             # Eliminar el proceso de PM2
pm2 monit                         # Monitor interactivo en tiempo real
```

---

## 📄 Licencia

MIT
