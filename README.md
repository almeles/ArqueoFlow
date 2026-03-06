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

## 🛠️ Gestión del proceso

```bash
pm2 status            # Ver estado
pm2 logs arqueoflow   # Ver logs en tiempo real
pm2 restart arqueoflow
pm2 stop arqueoflow
```

---

## 📄 Licencia

MIT
