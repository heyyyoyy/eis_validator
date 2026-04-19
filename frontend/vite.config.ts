import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const certsDir = path.resolve(__dirname, "../certs");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    https: {
      cert: fs.readFileSync(path.join(certsDir, "cert.pem")),
      key: fs.readFileSync(path.join(certsDir, "key.pem")),
    },
    proxy: {
      "/parse": {
        target: "https://localhost:3000",
        secure: false,
      },
      "/validate": {
        target: "https://localhost:3000",
        secure: false,
      },
    },
  },
});
