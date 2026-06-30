import sharp from "sharp";
import { processImageUpload, UploadRejected, claimedExtension } from "../uploads/image-pipeline";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? pass++ : (fail++, console.log("FAIL:", m)); };
const rejects = async (fn: () => Promise<unknown>, m: string) => {
  try { await fn(); ok(false, m + " should reject"); }
  catch (e) { ok(e instanceof UploadRejected, m + (e instanceof UploadRejected ? ` (${e.reason})` : ` wrong error: ${e}`)); }
};

(async () => {
  const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#4488cc" } }).png().toBuffer();
  const jpeg = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#cc4444" } }).jpeg().toBuffer();

  const r = await processImageUpload(png, "photo.png", "image/png");
  ok(r.contentType === "image/webp", "re-encoded to webp");
  ok(/^[0-9a-f-]{36}\.webp$/i.test(r.storageKey), "UUID storage key, no client filename");
  ok(r.width === 40 && r.height === 30, "dimensions preserved");
  const r2 = await processImageUpload(jpeg, "photo.jpg", "image/jpeg");
  ok(r2.bytes > 0, "jpeg accepted");

  const trav = await processImageUpload(png, "../../../../etc/passwd.png", "image/png");
  ok(!trav.storageKey.includes(".."), "traversal filename discarded");
  ok(!trav.storageKey.includes("/") && !trav.storageKey.includes("\\"), "no path separators in key");
  ok(claimedExtension("../../evil.png") === "png", "extension parsed without path");
  ok(claimedExtension(String.raw`C:\windows\x.PNG`) === "png", "windows path stripped");

  const shell = Buffer.from("<?php system($_GET['c']); ?>");
  const polyglot = Buffer.concat([png, shell]);
  const pr = await processImageUpload(polyglot, "poly.png", "image/png");
  ok(!pr.buffer.includes("<?php"), "POLYGLOT: php payload destroyed by re-encode");
  ok(!pr.buffer.includes("system("), "POLYGLOT: no shell remnant");

  const withExif = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#fff" } })
    .withMetadata({ exif: { IFD0: { Copyright: "SECRET-GPS-MARKER" } } }).jpeg().toBuffer();
  ok(withExif.includes("SECRET-GPS-MARKER"), "precondition: exif present in source");
  const stripped = await processImageUpload(withExif, "e.jpg", "image/jpeg");
  ok(!stripped.buffer.includes("SECRET-GPS-MARKER"), "EXIF stripped by re-encode");

  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  await rejects(() => processImageUpload(svg, "x.svg", "image/svg+xml"), "SVG rejected");
  await rejects(() => processImageUpload(svg, "x.png", "image/png"), "SVG disguised as png rejected");

  const php = Buffer.from("<?php system($_GET['c']); ?>");
  await rejects(() => processImageUpload(php, "shell.png", "image/png"), "php-as-png rejected on magic bytes");
  const html = Buffer.from("<html><script>alert(1)</script></html>");
  await rejects(() => processImageUpload(html, "x.jpg", "image/jpeg"), "html-as-jpg rejected");

  const gif = Buffer.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // "GIF89a"
    0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff,
    0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
  ]);
  await rejects(() => processImageUpload(gif, "a.gif", "image/gif"), "GIF rejected");

  await rejects(() => processImageUpload(png, "evil.php", "image/png"), "disallowed extension rejected");

  await rejects(() => processImageUpload(Buffer.alloc(0), "a.png", "image/png"), "empty file rejected");

  console.log(`\nUpload pipeline: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
