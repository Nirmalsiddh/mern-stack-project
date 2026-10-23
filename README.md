# MERN Stack Project

This is a full-stack web application built with Node.js, Express.js, MongoDB, and EJS. The project includes user authentication, listing management, image uploads, and a responsive interface following the MVC architecture.

## Live Demo

Application: https://mern-stack-project-90uh.onrender.com

---

## Features

- User registration and login
- Secure authentication using Passport.js
- Create, update, and delete listings
- Country search and category filters
- Create and delete reviews with author authorization
- Image upload with cloud storage
- Responsive interface built with Bootstrap
- MVC architecture for better code organization
- RESTful routing
- Server-side rendering using EJS

---

## Tech Stack

### Backend

- Node.js
- Express.js
- MongoDB
- Mongoose
- Passport.js

### Frontend

- EJS
- HTML
- CSS
- JavaScript
- Bootstrap
- Font Awesome

---

## Project Structure

```text
majorProject
│
├── controllers
├── init
├── models
├── public
├── routes
├── views
├── middleware.js
├── app.js
├── package.json
└── README.md
```

---

## Getting Started

### Clone the repository

```bash
git clone https://github.com/Nirmalsiddh/mern-stack-project.git
cd mern-stack-project
```

### Install dependencies

Use Node.js **22.23.4**, pinned in `.nvmrc` (`package.json` requires Node 22).
If you use nvm, run `nvm use` before installing.

```bash
npm ci
```

### Configure the application and database

Create `.env` from `.env.example` only if you do not already have one, then supply
your local settings as described below. Keep an existing `.env` intact.

A running MongoDB service is required. The example uses
`mongodb://127.0.0.1:27017/wanderlust`; alternatively, configure your own development
MongoDB URI. Startup waits for the database connection and required rate-limit
and session TTL indexes before listening. Database permissions must allow those
index operations. Do not run the seed script against existing data.

### Start the server

```bash
npm start
```

Open your browser and visit:

```text
http://localhost:8080
```

`PORT` overrides the default port of 8080.

---

## Environment Variables

Use [.env.example](.env.example) as the configuration reference; it contains no
credentials. At minimum, supply:

| Setting | Requirement |
|---|---|
| `ATLASDB_URL` | A reachable MongoDB connection URI for the intended environment. |
| `SECRET` | A securely generated random secret of at least 32 characters; never commit it. |
| `UPLOADS_ENABLED` | The example sets `false`, allowing local use without Cloudinary. Set `true` only with all three `CLOUD_*` settings securely supplied. |
| `NODE_ENV` | Use `development` locally. Production reads injected environment variables rather than loading `.env`. |
| `TRUST_PROXY` | Leave blank for direct local connections; production accepts explicit trusted proxy IPs/CIDRs only. |

The example includes a local secret-generation command. Missing required settings
cause startup to fail safely. Production requires HTTPS, a strong secret, and
either all Cloudinary settings or explicitly disabled uploads. Review the
[security and operations guide](docs/phase2-security.md) before deployment.

## Future Enhancements

- User profile management
- Interactive maps for listing locations
- Improved UI and animations

---

## Author

Nirmal Siddh
## Regression tests

Use the pinned Node.js 22.23.4 runtime (`.nvmrc`) and install dependencies with `npm ci`.

```bash
npm test
```

This runs the unit, template, browser-script, security, and mocked-upload tests without a
MongoDB connection. The HTTP/database suite is explicitly skipped unless a safe
test target is supplied. To run the complete suite against a local MongoDB:

```bash
HAVENHUB_TEST_MONGODB_URL=mongodb://127.0.0.1:27017/havenhub_test npm test
```

The suite only accepts an explicit loopback `havenhub_test` database name, adds a
random suffix for each run, and verifies that the resulting database is empty
before writing. It starts a separate application process on an ephemeral port
with a temporary session secret. It never uses your application's `ATLASDB_URL`,
changes `.env`, or runs the seed script. Cleanup deletes only document IDs from
that isolated run; it does not drop databases or reset collections. Interrupted
runs may leave isolated test records behind.

Cloudinary upload handling is mocked for authorization checks. No real uploads
or Cloudinary asset deletions are performed. Real Cloudinary integration still
requires separate verification with securely supplied credentials.

## Security and operations

Phase 2 setup, proxy requirements, security controls, audit evidence, and known
limits are documented in [docs/phase2-security.md](docs/phase2-security.md).
Start with `.env.example`, supply a strong random `SECRET`, and keep actual
credentials outside Git. Production requires HTTPS and explicit trusted proxy
addresses if TLS terminates upstream. Logout now uses its POST form with CSRF
protection. Existing Phase 1 sessions require reauthentication after this update.
