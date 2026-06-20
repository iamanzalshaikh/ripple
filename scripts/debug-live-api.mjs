import { readFileSync } from "node:fs";
import { File } from "node:buffer";
import { join } from "node:path";

const API = "http://127.0.0.1:3007/api/v1";
const FIX = join(process.cwd(), "electron/automation/voice/nlu/__tests__/fixtures/whisper");

async function main() {
  const signup = await fetch(`${API}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `dbg_${Date.now()}@t.com`,
      password: "TestPass123!",
      name: "Dbg",
    }),
  });
  const token = (await signup.json())?.data?.token;
  if (!token) throw new Error("no token");

  for (const name of ["mera-resume.wav", "message-noor.wav"]) {
    const buf = readFileSync(join(FIX, name));
    const form = new FormData();
    form.append("audio", new File([buf], name, { type: "audio/wav" }));
    const res = await fetch(`${API}/voice/transcribe`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    console.log(name, res.status, await res.text());
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
