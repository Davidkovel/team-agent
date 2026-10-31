// Google autocomplete -> long search phrases (4+ words). Usage: node sugestoes.js "seed one" "seed two" ...
const hl = "en", gl = "us";
const seeds = process.argv.slice(2);
(async () => {
  const out = new Set();
  for (const s of seeds) for (const suf of ["", " a", " f", " u", " c", " n"]) {
    try {
      const r = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&hl=${hl}&gl=${gl}&q=` + encodeURIComponent(s + suf));
      for (const k of (await r.json())[1]) out.add(k);
    } catch (e) {}
  }
  console.log([...out].filter(k => k.split(" ").length >= 4).join("\n"));
})();
