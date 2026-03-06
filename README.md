# ArqueoFlow

Sistema multi-usuario de gestión de rutas con panel de administración y conversión de moneda para Telegram.

---

## Características

- **Panel de Administrador** con aprobación de usuarios, asignación de rutas y exportación CSV.
- **Flujo de Arqueo** guiado paso a paso (Planilla → Ruta → Billetes USD → Billetes NIO → Resumen → Confirmación).
- **Conversión automática** de USD a NIO usando una tasa de cambio configurable (default: 36.6243).
- Base de datos SQLite local (`better-sqlite3`), sin dependencias externas.
- Gestión de procesos con **pm2**.

---

## Requisitos

- Node.js ≥ 18
- npm
- pm2 (instalado globalmente)

```bash
npm install -g pm2
```

---

## Instalación

```bash
# 1. Clonar el repositorio
git clone https://github.com/almeles/ArqueoFlow.git
cd ArqueoFlow

# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno
cp .env.example .env
```

Edita `.env` con tus valores:

```env
BOT_TOKEN=tu_token_de_botfather
ADMIN_TELEGRAM_ID=tu_id_de_telegram
```

> **Cómo obtener tu Telegram ID:** Escríbele a [@userinfobot](https://t.me/userinfobot) en Telegram y te responderá con tu ID numérico.

---

## Ejecución

### Modo desarrollo

```bash
node index.js
```

### Modo producción (pm2)

```bash
# Iniciar
pm2 start ecosystem.config.js

# Ver logs
pm2 logs arqueoflow

# Reiniciar
pm2 restart arqueoflow

# Detener
pm2 stop arqueoflow

# Guardar configuración y habilitar inicio automático
pm2 save
pm2 startup
```

---

## Comandos del Bot

### Usuarios

| Comando    | Descripción                              |
|------------|------------------------------------------|
| `/start`   | Solicitar acceso al sistema              |
| `/nuevo`   | Iniciar un nuevo arqueo de caja          |
| `/cancelar`| Cancelar la operación en curso           |
| `/ayuda`   | Ver comandos disponibles                 |

### Administrador

| Comando    | Descripción                              |
|------------|------------------------------------------|
| `/admin`   | Abrir el panel de administración         |
| `/cancelar`| Cancelar la operación en curso           |

---

## Panel de Administración (`/admin`)

### 💱 Tasa de Cambio
Ver y editar la tasa de cambio USD → NIO utilizada en todos los cálculos.

### 👥 Usuarios
- Ver lista completa de usuarios (✅ aprobado / ⏳ pendiente).
- Seleccionar un usuario para:
  - **Asignar Ruta**: ingresar las rutas permitidas separadas por coma (ej. `Ruta Norte, Ruta Centro`).
  - **Bloquear**: revocar el acceso del usuario.

### 📊 Exportar CSV
Descargar todos los reportes en formato CSV (compatible con Excel, con BOM UTF-8).

---

## Flujo de Aprobación de Usuarios

1. El usuario envía `/start`.
2. El bot notifica al administrador con botones **✅ Aprobar** / **❌ Rechazar**.
3. Al aprobar, el administrador asigna rutas al usuario.
4. El usuario recibe confirmación y puede usar `/nuevo`.

---

## Base de Datos

El archivo `arqueoflow.db` se crea automáticamente en la raíz del proyecto.

| Tabla     | Columnas principales                                                  |
|-----------|-----------------------------------------------------------------------|
| `users`   | `telegram_id`, `name`, `planilla`, `allowed_routes`, `is_approved`, `is_admin` |
| `reports` | `id`, `user_id`, `planilla`, `route`, `details`, `total_nio`, `timestamp` |
| `config`  | `key`, `value` (ej. `exchange_rate`)                                 |

---

## Variables de Entorno

| Variable             | Descripción                                        |
|----------------------|----------------------------------------------------|
| `BOT_TOKEN`          | Token del bot obtenido de [@BotFather](https://t.me/BotFather) |
| `ADMIN_TELEGRAM_ID`  | ID numérico de Telegram del Super Administrador    |