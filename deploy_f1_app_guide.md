# F1 Telemetry App Deployment Guide

This guide outlines the step-by-step process for deploying your F1 Telemetry application so that the frontend lives on `f1.overcutacademy.com`, the backend API runs on Render, and any necessary databases are on Supabase.

## Architecture Overview
- **Domain/DNS**: Hostgator (managing `overcutacademy.com`)
- **Frontend**: Netlify (React/Vite/TypeScript)
- **Backend**: Render (Python/FastAPI)
- **Database**: Supabase (PostgreSQL) - if persistence/caching is needed

---

## Step-by-Step Deployment Process

### 1. Database Setup (Supabase) - *If needed*
If your backend needs to store user data or cache F1 API responses to avoid rate limits:
1. Go to [Supabase](https://supabase.com/) and create a new project.
2. Obtain your **Database connection string** (PostgreSQL URL) and **Anon Key**.
3. We will add these as Environment Variables in the Render backend.

### 2. Prepare the Codebase for Production
Before deploying, we need to ensure the frontend and backend can talk to each other securely in production.
- **Backend CORS**: Update `main.py` (or your FastAPI app) to allow CORS from `https://f1.overcutacademy.com`.
- **Frontend API URL**: Update the frontend to point to the live Render backend URL instead of `http://localhost`. This is usually done via a `.env` file (e.g., `VITE_API_URL=https://your-render-app.onrender.com`).

### 3. Backend Deployment (Render)
Render integrates seamlessly with GitHub.
1. Push your entire codebase to a GitHub repository.
2. Log into [Render](https://render.com/) and click **New+** -> **Web Service**.
3. Connect your GitHub repository.
4. **Configuration Settings**:
   - **Root Directory**: `f1-telemetry-app/backend`
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt` (or if using poetry/pipenv, use that)
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. **Environment Variables**:
   - `FRONTEND_URL`: `https://f1.overcutacademy.com`
   - Any Supabase keys if needed.
6. Click **Deploy**. Once finished, Render will give you a `.onrender.com` URL.

### 4. Frontend Deployment (Netlify)
Netlify also strongly integrates with GitHub but can be deployed via terminal. Let's use the standard GitHub method initially.
1. Log into [Netlify](https://www.netlify.com/) and click **Add new site** -> **Import an existing project**.
2. Connect your GitHub repository.
3. **Configuration Settings**:
   - **Base directory**: `f1-telemetry-app/frontend`
   - **Build command**: `npm run build` (or `yarn build`)
   - **Publish directory**: `f1-telemetry-app/frontend/dist` (or `build`, depending on your framework)
4. **Environment Variables**:
   - Add your newly created Render URL (e.g., `VITE_API_URL=https://your-render-app.onrender.com`).
5. Click **Deploy**. Netlify will give you a temporary URL (e.g., `friendly-unicorn-123.netlify.app`).

### 5. Custom Domain & DNS (Hostgator)
Now we point your hostgator subdomain to the Netlify site.
1. In Netlify, go to **Domain management** -> **Add custom domain**.
2. Enter `f1.overcutacademy.com`. Netlify will ask you to verify it and will tell you to create a **CNAME record**.
3. Log into your **Hostgator cPanel**.
4. Go to **Zone Editor** (or Advanced DNS Zone Editor).
5. Add a **CNAME Record**:
   - **Name**: `f1`
   - **CNAME (Target)**: Enter your Netlify temporary URL (e.g., `friendly-unicorn-123.netlify.app`).
6. Save the record. Back in Netlify, hit **Verify DNS**. 
*Note: DNS changes can take a few minutes to a few hours to propagate.*
7. Netlify will automatically provision a free SSL/TLS certificate (HTTPS) once the DNS resolves correctly.

---

## 🤖 How I (AI) Can Handle Everything For You

If you want me to do the heavy lifting from right here inside our IDE/terminal, we can automate most of this! Since deploying mostly requires interacting with third-party servers, here is how we can proceed:

### What I can automate for you:
1. **Code Prep**: I can configure the CORS headers in Python and the environment variables in the frontend framework right now.
2. **Git & GitHub**: If you let me know you're okay with it, I can initialize a Git repository locally and commit all the code.
3. **Deploying Frontend**: I can deploy the frontend directly to Netlify from your computer without leaving the editor using the `netlify-cli`.
4. **Deploying Backend**: If you provide a Render API key, or if we use GitHub actions, I can script the deployment.

### What you need to provide/do:

To give me the capabilities (via MCP servers or local CLI tools), you'll need the following:

1. **GitHub Access**: 
   - Please install the [GitHub CLI](https://cli.github.com/) and run `gh auth login` in your terminal. This allows me to create repos and push code via terminal commands.
   - *(Optional)* Alternatively, you can configure the [GitHub MCP Server](https://github.com/modelcontextprotocol/servers/tree/main/src/github) and pass me a Personal Access Token.

2. **Netlify CLI Access**:
   - I can install this for you. I just need you to run `netlify login` in your terminal so your browser can authenticate your Netlify account on this machine. After that, I can use terminal commands to create and publish the site.

3. **Render Access**:
   - Render requires you to initiate the Web Service from their dashboard linked to your GitHub. Once we push the code to GitHub in step 1, you will quickly need to set up the Web Service on Render's website (since their free tier doesn't support full API automation).
   - *If you have a paid Render plan*, you can give me an API key and I can automate it!

4. **Hostgator**:
   - **Manual step for you**: Unfortunately, Hostgator doesn't provide a developer-friendly CLI for us to automate CNAME records easily. You will need to log into cPanel and add the `f1 -> your-netlify-url.netlify.app` CNAME record yourself.

### Your Next Action:
If you want me to do the main work:
1. Open your terminal and run `gh auth login` (if you use GitHub).
2. Let me know when you're ready, and I'll prep the code (CORS & Env vars) and push it to GitHub. Then, I'll install the Netlify CLI to start publishing the frontend!
