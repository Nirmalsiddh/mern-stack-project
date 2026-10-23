# MERN Stack Project

This is a full-stack web application built with Node.js, Express.js, MongoDB, and EJS. The project includes user authentication, listing management, image uploads, and a responsive interface following the MVC architecture.

## Live Demo

Application: https://mern-stack-project-90uh.onrender.com

---

## Features

- User registration and login
- Secure authentication using Passport.js
- Create, update, and delete listings
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
git clone https://github.com/your-username/mern-stack-project.git
cd mern-stack-project
```

### Install dependencies

```bash
npm install
```

### Start the server

```bash
node app.js
```

Open your browser and visit:

```text
http://localhost:3000
```

---

## Environment Variables

Create a `.env` file in the root directory and add the following:

```env
ATLASDB_URL=your_mongodb_connection_string
SECRET=your_session_secret
CLOUD_NAME=your_cloudinary_name
CLOUD_API_KEY=your_cloudinary_api_key
CLOUD_API_SECRET=your_cloudinary_api_secret

```

## Future Enhancements

- Search and filter listings
- User profile management
- Reviews and ratings
- Interactive maps for listing locations
- Improved UI and animations

---

## Author

Nirmal Siddh
## Phase 1 regression tests

Use the pinned Node.js 20.18.0 runtime and install dependencies with `npm ci`.

```bash
npm test
```

This runs the unit, template, browser-script, and mocked-upload tests without a
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
