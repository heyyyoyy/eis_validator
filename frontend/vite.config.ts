import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const certsDir = path.resolve(__dirname, "../certs");
const certPath = path.join(certsDir, "cert.pem");
const keyPath = path.join(certsDir, "key.pem");

// Only enable HTTPS in the dev server when local certs are present.
// During `npm run build` (Docker or CI) the server block is irrelevant,
// so we skip the readFileSync calls entirely to avoid ENOENT errors.
const certsExist = fs.existsSync(certPath) && fs.existsSync(keyPath);

const httpsConfig = certsExist
  ? { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }
  : undefined;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    https: httpsConfig,
    proxy: {
      "/parse": {
        target: httpsConfig ? "https://localhost:3000" : "http://localhost:3000",
        secure: false,
      },
      "/validate": {
        target: httpsConfig ? "https://localhost:3000" : "http://localhost:3000",
        secure: false,
      },
    },
  },
});
