export default function ApiKeyNotice() {
  return (
    <div className="rounded-lg border border-blood-500/40 bg-blood-600/10 px-4 py-3 text-sm">
      <p className="font-semibold text-blood-500">DeepSeek API key missing</p>
      <p className="mt-1 text-white/70">
        Run <code className="rounded bg-black/40 px-1.5 py-0.5 text-gold-400">npm run setup</code> in the
        project folder, paste your key, then restart <code className="rounded bg-black/40 px-1.5 py-0.5">npm run dev</code>.
      </p>
    </div>
  );
}
