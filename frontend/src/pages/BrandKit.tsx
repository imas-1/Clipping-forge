import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { BrandKit } from "../api/client";
import { loadBrandKit, saveBrandKit } from "../lib/brandKitStorage";

const ACCENTS = ["#ff3b5c", "#17e9b6", "#7c5cff", "#ffb020", "#ff6b85"];

export default function BrandKitPage() {
  const [kit, setKit] = useState<BrandKit>({ brandName: "", accentColor: ACCENTS[0], watermark: true });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const existing = loadBrandKit();
    if (existing) setKit(existing);
  }, []);

  function handleSave() {
    saveBrandKit(kit);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  return (
    <div className="mx-auto max-w-xl px-6 pt-14 pb-24">
      <h1 className="font-display text-3xl font-semibold">Brand kit</h1>
      <p className="mt-1 text-white/45">
        Set this once — the AI applies it to every future project automatically. You won't be asked again per video.
      </p>

      <div className="card mt-8 space-y-6 p-6">
        <div>
          <label className="label-eyebrow mb-2 block">Brand name (used as watermark text)</label>
          <input
            value={kit.brandName}
            onChange={(e) => setKit({ ...kit, brandName: e.target.value })}
            placeholder="e.g. YOURNAME"
            className="w-full rounded-lg border border-ink-700 bg-ink-850 px-3.5 py-2.5 placeholder:text-white/25 focus:outline-none focus:border-signal/40"
          />
        </div>

        <div>
          <label className="label-eyebrow mb-2 block">Accent color</label>
          <div className="flex gap-2">
            {ACCENTS.map((c) => (
              <button
                key={c}
                onClick={() => setKit({ ...kit, accentColor: c })}
                className="flex h-9 w-9 items-center justify-center rounded-full border-2"
                style={{ backgroundColor: c, borderColor: kit.accentColor === c ? "white" : "transparent" }}
              >
                {kit.accentColor === c && <Check size={14} className="text-black/70" />}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center justify-between rounded-lg border border-ink-700 bg-ink-850 px-4 py-3">
          <div>
            <p className="text-sm font-medium">Watermark</p>
            <p className="text-xs text-white/40">Show your brand name subtly in the corner of every clip</p>
          </div>
          <input
            type="checkbox"
            checked={kit.watermark}
            onChange={(e) => setKit({ ...kit, watermark: e.target.checked })}
            className="h-5 w-5 accent-signal"
          />
        </label>

        <button onClick={handleSave} className="btn-primary w-full">
          {saved ? <Check size={16} /> : null}
          {saved ? "Saved" : "Save brand kit"}
        </button>
      </div>
    </div>
  );
}
