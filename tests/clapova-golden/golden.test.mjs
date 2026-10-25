// Tests de la suite golden elle-même (sans Chrome) : générateur déterministe,
// contrat des compositions, médias ffmpeg, mesures SSIM / loudness, règles de comparaison.
// Lancer : node --test tests/clapova-golden/
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { build, BUILD_DIR } from "./build.mjs";
import { compareResult } from "./lib/compare.mjs";
import { composeHtml, volumeLane } from "./lib/compose.mjs";
import { COMPOSITIONS } from "./lib/compositions.mjs";
import {
  extractFrame,
  loudness,
  parseIntegratedLufs,
  parseSsim,
  probe,
  run,
  ssim,
} from "./lib/metrics.mjs";

const tmp = await mkdtemp(join(tmpdir(), "golden-test-"));
after(() => rm(tmp, { recursive: true, force: true }));

describe("compositions de référence", () => {
  it("en compte 10 aux identifiants uniques", () => {
    assert.equal(COMPOSITIONS.length, 10);
    assert.equal(new Set(COMPOSITIONS.map((c) => c.id)).size, 10);
  });

  it("couvre 16:9, 9:16, voix+musique, transitions, titres animés, vidéo sans son", () => {
    const tags = new Set(COMPOSITIONS.flatMap((c) => c.tags));
    for (const t of [
      "16:9",
      "9:16",
      "voix",
      "musique",
      "transition",
      "titre-anime",
      "video-muette",
    ]) {
      assert.ok(tags.has(t), `tag manquant : ${t}`);
    }
    assert.ok(
      COMPOSITIONS.some((c) => !c.audio),
      "au moins une composition sans son",
    );
  });

  for (const spec of COMPOSITIONS) {
    it(`${spec.id} : HTML conforme au contrat compose.ts et déterministe`, () => {
      const html = composeHtml(spec);
      assert.equal(html, composeHtml(spec));
      assert.equal((html.match(/data-composition-id=/g) ?? []).length, 1);
      assert.match(html, new RegExp(`data-width="${spec.width}" data-height="${spec.height}"`));
      assert.match(html, /window\.__timelines\["/);
      assert.doesNotMatch(html, /crossorigin|\.play\(\)|Math\.random|Date\.now/);
      for (const m of html.matchAll(/<audio\b[^>]*>/g))
        assert.match(m[0], /\bid="/, "audio sans id");
      for (const m of html.matchAll(/<video\b[^>]*>/g)) {
        assert.ok(
          /\bmuted\b/.test(m[0]) || /data-has-audio="true"/.test(m[0]),
          "vidéo ni muted ni data-has-audio",
        );
      }
      for (const f of spec.frames)
        assert.ok(f >= 0 && f < Math.max(...spec.clips.map((c) => c.start + c.duration)));
    });
  }

  it("sans son : aucun <audio> ni data-has-audio", () => {
    for (const spec of COMPOSITIONS.filter((c) => !c.audio)) {
      const html = composeHtml(spec);
      assert.doesNotMatch(html, /<audio|data-has-audio/, spec.id);
    }
  });
});

describe("volumeLane", () => {
  it("baisse la musique pendant la parole puis la rend", () => {
    const pts = volumeLane({
      duration: 6,
      volume: 1,
      speech: [[1, 3]],
      duck: { level: 0.25, attack: 0.08, release: 0.3 },
    });
    const at = (t) => pts.filter((p) => p.t <= t).at(-1).v;
    assert.equal(at(0.5), 1);
    assert.equal(at(2), 0.25);
    assert.equal(at(3.4), 1);
  });
});

describe("règles de comparaison", () => {
  const ref = { fps: 30, hasAudio: true, lufs: -20, duration: 5 };
  const good = { hasAudio: true, lufs: -20.4, duration: 5.03 };
  it("accepte SSIM >= 0,99, ±0,5 LU et ±1 frame", () => {
    assert.deepEqual(compareResult(ref, good, [{ t: 1, ssim: 0.99 }]), []);
  });
  it("refuse SSIM < 0,99", () => {
    assert.equal(compareResult(ref, good, [{ t: 1, ssim: 0.9899 }]).length, 1);
  });
  it("refuse un écart de loudness > 0,5 LU", () => {
    assert.equal(compareResult(ref, { ...good, lufs: -19.4 }, []).length, 1);
  });
  it("refuse un flux audio inattendu ou absent", () => {
    assert.equal(compareResult({ ...ref, hasAudio: false, lufs: null }, good, []).length, 1);
    assert.equal(compareResult(ref, { ...good, hasAudio: false, lufs: null }, []).length, 1);
  });
  it("refuse une durée à plus d'une frame", () => {
    assert.equal(compareResult(ref, { ...good, duration: 5.05 }, []).length, 1);
  });
});

describe("analyse de la sortie ffmpeg", () => {
  it("lit SSIM et LUFS", () => {
    assert.equal(
      parseSsim(
        "[Parsed_ssim_0 @ 0x1] SSIM R:0.99 (20.0) G:0.99 (20.0) B:0.99 (20.0) All:0.987654 (19.1)",
      ),
      0.987654,
    );
    assert.equal(
      parseIntegratedLufs(
        "noise\n  Integrated loudness:\n    I:         -23.4 LUFS\n    Threshold: -33.4 LUFS",
      ),
      -23.4,
    );
    assert.equal(parseIntegratedLufs("Integrated loudness:\n    I:         -inf LUFS"), null);
  });
});

describe("mesures ffmpeg", () => {
  const sine = async (name, amp) => {
    const out = join(tmp, name);
    const r = await run("ffmpeg", [
      "-hide_banner",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=1000:sample_rate=48000:duration=4`,
      "-af",
      `volume=${amp}`,
      out,
    ]);
    assert.equal(r.code, 0, r.stderr);
    return out;
  };

  it("loudness : +6 dB de gain = +6 LU", async () => {
    const a = await loudness(await sine("a.wav", "-20dB"));
    const b = await loudness(await sine("b.wav", "-14dB"));
    assert.ok(a.hasAudio);
    assert.ok(Math.abs(b.lufs - a.lufs - 6) < 0.1, `${a.lufs} -> ${b.lufs}`);
  });

  it("loudness : sans flux audio", async () => {
    const v = join(tmp, "muet.mp4");
    await run("ffmpeg", [
      "-hide_banner",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=64x64:d=1:r=30",
      "-pix_fmt",
      "yuv420p",
      v,
    ]);
    assert.deepEqual(await loudness(v), { hasAudio: false, lufs: null });
  });

  it("SSIM : 1 pour deux images identiques, < 0,99 pour deux images différentes", async () => {
    const mk = async (name, src) => {
      const out = join(tmp, name);
      const r = await run("ffmpeg", [
        "-hide_banner",
        "-y",
        "-f",
        "lavfi",
        "-i",
        src,
        "-frames:v",
        "1",
        out,
      ]);
      assert.equal(r.code, 0, r.stderr);
      return out;
    };
    const a = await mk("a.png", "testsrc2=size=320x240");
    const a2 = await mk("a2.png", "testsrc2=size=320x240");
    const b = await mk("b.png", "gradients=size=320x240:seed=1:speed=0");
    assert.ok((await ssim(a, a2)) >= 0.9999);
    assert.ok((await ssim(a, b)) < 0.99);
  });
});

describe("build des compositions", { timeout: 300000 }, () => {
  it("génère HTML et médias ffmpeg pour les 10 compositions", async () => {
    const ids = await build();
    assert.equal(ids.length, 10);
    for (const spec of COMPOSITIONS) {
      const html = await readFile(join(BUILD_DIR, spec.id, "index.html"), "utf8");
      assert.equal(html, composeHtml(spec));
      for (const c of spec.clips.filter((x) => x.src)) {
        const p = await probe(join(BUILD_DIR, spec.id, c.src));
        if (c.kind === "video") assert.equal(p.hasAudio, Boolean(c.sound), `${spec.id}/${c.src}`);
        if (c.kind === "video" || c.kind === "image") {
          assert.ok(
            p.width >= p.height === spec.width >= spec.height,
            `orientation ${spec.id}/${c.src}`,
          );
        }
      }
    }
    // Les médias sont reproductibles : deux générations donnent les mêmes octets.
    const first = await readFile(join(BUILD_DIR, COMPOSITIONS[2].id, "assets/voix.wav"));
    await build([COMPOSITIONS[2].id]);
    assert.deepEqual(first, await readFile(join(BUILD_DIR, COMPOSITIONS[2].id, "assets/voix.wav")));
    await extractFrame(
      join(BUILD_DIR, COMPOSITIONS[2].id, "assets/plan-a.mp4"),
      1,
      join(tmp, "f.png"),
    );
  });
});
