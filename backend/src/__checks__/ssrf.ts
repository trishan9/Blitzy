process.env.SSRF_ALLOWED_HOSTS = "images.example.com,cdn.partner.io";
import { validateUrl, classifyAddress, SsrfBlocked, type Resolver } from "../security/safe-fetch";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? pass++ : (fail++, console.log("FAIL:", m)); };

const res = (map: Record<string, string>): Resolver => async (h) => {
  const a = map[h]; if (!a) throw new Error("NXDOMAIN");
  return { address: a, family: a.includes(":") ? 6 : 4 };
};
const good = res({ "images.example.com": "93.184.216.34", "cdn.partner.io": "93.184.216.34" });

const denied = async (url: string, r: Resolver, label: string) => {
  try { await validateUrl(url, r); ok(false, label + " should be blocked"); }
  catch (e) { ok(e instanceof SsrfBlocked, label); }
};
const allowed = async (url: string, r: Resolver, label: string) => {
  try { await validateUrl(url, r); ok(true, label); }
  catch (e) { ok(false, label + " should be allowed: " + (e as Error).message); }
};

(async () => {
  await allowed("https://images.example.com/a.png", good, "allowlisted host permitted");

  await denied("http://images.example.com/a.png", good, "http rejected");
  await denied("file:///etc/passwd", good, "file: rejected");
  await denied("gopher://images.example.com/", good, "gopher: rejected");
  await denied("dict://images.example.com:11211/", good, "dict: rejected");

  await denied("https://images.example.com@evil.com/", good, "userinfo bypass rejected");
  await denied("https://user:pw@images.example.com/", good, "credentials rejected");

  await denied("https://evil.com/", res({ "evil.com": "93.184.216.34" }), "non-allowlisted host");
  await denied("https://sub.images.example.com/", res({ "sub.images.example.com": "1.2.3.4" }), "subdomain not allowlisted");
  await denied("https://images.example.com.evil.com/", res({ "images.example.com.evil.com": "1.2.3.4" }), "suffix-append bypass");

  await denied("https://images.example.com/", res({ "images.example.com": "127.0.0.1" }), "loopback via DNS");
  await denied("https://images.example.com/", res({ "images.example.com": "10.0.0.5" }), "private 10/8 via DNS");
  await denied("https://images.example.com/", res({ "images.example.com": "172.16.0.1" }), "private 172.16/12");
  await denied("https://images.example.com/", res({ "images.example.com": "192.168.1.1" }), "private 192.168/16");
  await denied("https://images.example.com/", res({ "images.example.com": "169.254.169.254" }), "AWS metadata");
  await denied("https://images.example.com/", res({ "images.example.com": "::1" }), "IPv6 loopback");
  await denied("https://images.example.com/", res({ "images.example.com": "fd00::1" }), "IPv6 unique-local");
  await denied("https://images.example.com/", res({ "images.example.com": "fd00:ec2::254" }), "IPv6 metadata");
  await denied("https://images.example.com/", res({ "images.example.com": "::ffff:127.0.0.1" }), "IPv4-mapped loopback");
  await denied("https://images.example.com/", res({ "images.example.com": "0.0.0.0" }), "unspecified");
  await denied("https://images.example.com/", res({ "images.example.com": "100.64.0.1" }), "carrier-grade NAT");

  await denied("https://2130706433/", res({ "2130706433": "127.0.0.1" }), "decimal IP");
  await denied("https://0177.0.0.1/", res({ "0177.0.0.1": "127.0.0.1" }), "octal IP");
  await denied("https://[::1]/", res({ "[::1]": "::1", "::1": "::1" }), "bracketed IPv6 literal");

  await denied("not-a-url", good, "malformed URL");

  ok(classifyAddress("93.184.216.34") === null, "public IP accepted");
  ok(classifyAddress("127.0.0.1") !== null, "loopback classified");
  ok(classifyAddress("169.254.169.254") === "cloud-metadata", "metadata named");
  ok(classifyAddress("::ffff:10.0.0.1") !== null, "mapped private classified");
  ok(classifyAddress("garbage") === "unparseable-address", "unparseable");

  console.log(`\nSSRF guard: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
