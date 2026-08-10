# HASH Cloud

Backend del ecosistema HASH.

## Responsabilidad

HASH Cloud es el núcleo de infraestructura del ecosistema HASH. Concentra los servicios de autenticación, contexto, memoria, compilación de conocimiento y comunicación con servicios externos.

No implementa el razonamiento del LLM.

---

## Estado del proyecto

**Sprint 1.1 — Completado**
Estructura base del proyecto inicializada.

**Sprint 1.2 — Completado**
Aplicación FastAPI funcionando localmente con endpoint `/health`.

**Sprint 1.3 — Completado**
Dockerfile y variables de entorno configurados.

**Sprint 2.1 — Completado**
Autenticación con Google OAuth implementada.

**Sprint 2.2 — Completado**
JWT implementado. El callback de Google genera un token. `/auth/me` valida el token y devuelve la identidad del usuario.

**Sprint 2.3 — Completado**
Autorización de rutas implementada mediante `Depends(require_auth)`.

**Sprint 3.1 — Completado**
Context API base implementada.

**Sprint 3.2 — Completado**
ContextProvider implementado. `/context` expone las cuatro fuentes del contexto interno de HASH.

**Sprint 4.1 — Completado**
Credenciales de usuario cifradas con Fernet y persistidas en Postgres.

**Sprint 4.2 — Completado**
Persistencia de chats implementada. Los chats y mensajes se guardan en Postgres. Los mensajes se cifran en reposo con Fernet.

**Sprint 5.1 — Completado**
Base Compiler implementado.

**Sprint 5.2 — Completado**
User Compiler implementado.

**Sprint 5.3 — Completado**
Style Compiler implementado.

**Sprint 5.4 — Completado**
Hash Compiler implementado.

**Sprint 6.1 — Completado**
Auditoría de seguridad pre-producción realizada y vulnerabilidades corregidas:
- Callback de autenticación migrado a código de un solo uso (60s TTL). El JWT nunca viaja en la URL.
- Endpoint `/memory/authorize` migrado de GET+query param a POST+Bearer token.
- Errores internos del backend ya no se exponen al cliente. Los detalles quedan en logs del servidor.
- Token en el frontend con expiración local de 1 hora y verificación periódica.
- Flag `isSending` implementado para evitar race conditions en el envío de mensajes.
- `Content-Security-Policy` y headers de seguridad añadidos en `vercel.json`.
- `escapeHtml()` completo incluyendo comilla simple.
- `activeChatId` de localStorage validado con regex antes de usarse.

---

## Dependencias

| Paquete | Versión |
|---|---|
| fastapi | 0.139.0 |
| uvicorn | 0.51.0 |
| authlib | 1.7.2 |
| httpx | 0.28.1 |
| python-dotenv | 1.2.2 |
| itsdangerous | 2.2.0 |
| PyJWT | 2.7.0 |
| google-api-python-client | 2.169.0 |
| google-auth | 2.40.3 |
| google-auth-oauthlib | 1.2.1 |
| cryptography | >=45.0.1 |
| psycopg2-binary | 2.9.10 |

Instalar:

```bash
pip install -r requirements.txt
```

---

## Variables de entorno

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Conexión a Postgres |
| `GOOGLE_CLIENT_ID` | Client ID del proyecto en Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Client Secret del proyecto en Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | URI de callback registrada en Google (`/auth/callback`) |
| `MEMORY_CALLBACK_URI` | URI de callback para OAuth de Google Drive (`/memory/callback`) |
| `SESSION_SECRET` | Clave secreta para firmar la sesión de OAuth |
| `JWT_SECRET` | Clave secreta para firmar los tokens JWT |
| `JWT_ALGORITHM` | Algoritmo JWT (default: `HS256`) |
| `JWT_EXPIRE_MINUTES` | Duración del token en minutos (default: `60`) |
| `CREDENTIALS_SECRET` | Clave Fernet de 44 caracteres para cifrar mensajes y credenciales |
| `GEMINI_API_KEY` | API key de Gemini |
| `GROQ_API_KEY` | API key de Groq (fallback) |
| `FISH_AUDIO_API_KEY` | API key de Fish Audio (síntesis de voz) |

Generar una clave Fernet válida:

```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Generar un JWT_SECRET seguro:

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

---

## Base de datos

Tablas creadas automáticamente al arrancar:

| Tabla | Descripción |
|---|---|
| `chats` | `chat_id`, `user_id`, `title`, `created_at`, `updated_at` |
| `chat_messages` | `id`, `chat_id`, `role`, `content` (cifrado), `created_at` |
| `credentials` | `user_id`, `refresh_token` (cifrado), `created_at` |
| `memory_users` | `user_id`, `created_at` |
| `memory_documents` | `id`, `user_id`, `key`, `name`, `description`, `created_at` |
| `memory_rows` | `id`, `document_id`, `data` (JSONB), `created_at` |

---

## Ejecución local

```bash
source .venv/bin/activate
uvicorn app.main:app --reload
```

Primera vez:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

---

## Endpoints disponibles

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/health` | No | Estado del servidor |
| GET | `/auth/login` | No | Inicia el flujo OAuth con Google |
| GET | `/auth/callback` | No | Callback de Google. Emite código de un solo uso |
| POST | `/auth/token` | No | Canjea el código por JWT |
| GET | `/auth/me` | Bearer JWT | Devuelve identidad del usuario autenticado |
| GET | `/chat/list` | Bearer JWT | Lista todos los chats del usuario |
| POST | `/chat/new` | Bearer JWT | Crea un chat vacío |
| GET | `/chat/{id}/messages` | Bearer JWT | Devuelve el historial de mensajes de un chat |
| PATCH | `/chat/{id}/title` | Bearer JWT | Renombra un chat |
| DELETE | `/chat/{id}` | Bearer JWT | Elimina un chat y todos sus mensajes |
| POST | `/chat` | Bearer JWT | Genera una respuesta (no-streaming) |
| POST | `/chat/stream` | Bearer JWT | Genera una respuesta en streaming |
| POST | `/chat/synthesize` | Bearer JWT | Sintetiza texto a audio (Fish Audio) |
| POST | `/chat/synthesize/stream` | Bearer JWT | Sintetiza texto a audio en streaming |
| GET | `/memory/status` | Bearer JWT | Estado de la memoria del usuario |
| POST | `/memory/authorize` | Bearer JWT | Inicia OAuth de Google Drive |
| GET | `/memory/callback` | No | Callback OAuth de Google Drive |
| GET | `/memory` | Bearer JWT | Lee la memoria del usuario |
| POST | `/memory` | Bearer JWT | Escribe en la memoria del usuario |
| DELETE | `/memory/{key}` | Bearer JWT | Elimina un documento de memoria |
| PATCH | `/memory/{key}/rename` | Bearer JWT | Renombra un documento de memoria |
| GET | `/compiler/base` | Bearer JWT | Construye el BaseContext de HASH |
| GET | `/compiler/style` | Bearer JWT | Construye el StyleContext de HASH |
| GET | `/docs` | No | Documentación interactiva |

---

## Flujo de autenticación

```
Usuario → GET /auth/login → Google → GET /auth/callback → code (60s) → POST /auth/token → JWT
```

## Flujo de chat

```
POST /chat/stream  →  guarda mensaje usuario  →  stream respuesta  →  guarda respuesta  →  devuelve chat_id
```

## Flujo de memoria

```
POST /memory/authorize (Bearer JWT) → Google Drive OAuth → GET /memory/callback → credenciales cifradas en Postgres
```

---

## Arquitectura

```
app/
├── main.py
├── auth/router.py
├── chat/
│   ├── router.py
│   ├── repository.py
│   └── models.py
├── llm/
│   ├── factory.py
│   ├── gemini.py
│   ├── groq.py
│   └── anthropic.py
├── voice/
│   ├── factory.py
│   ├── fish.py
│   └── provider.py
├── memory/
│   ├── router.py
│   ├── service.py
│   └── repository.py
├── context/
│   ├── router.py
│   └── provider.py
├── compiler/
│   ├── router.py
│   ├── base_compiler.py
│   ├── user_compiler.py
│   ├── style_compiler.py
│   └── hash_compiler.py
└── core/
    ├── config.py
    ├── jwt.py
    ├── encryption.py
    ├── database.py
    └── credentials_repository.py
```

---

## Desarrollo por Sprints

Este proyecto evoluciona por Sprints. Cada Sprint amplía este documento con información real ya implementada. No se documenta funcionalidad futura.
#   l i v r e - i a - f r o n t  
 