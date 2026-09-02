/* ==========================================================================
   markdown.js, a deliberately small subset renderer.
   HTML is escaped up front, so nothing a model returns can inject markup.
   ========================================================================== */

const esc = (s) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function inline(s) {
  return s
    .replace(/`([^`\n]+)`/g, (_, code) => `<code>${code}</code>`)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

export function render(src) {
  const lines = esc(src ?? "").split("\n");
  const out = [];
  let para = [];
  let list = null;      // "ul" | "ol" | null
  let fence = null;     // language string while inside ```

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join("<br>"))}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list) { out.push(`</${list}>`); list = null; }
  };

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*```(\w*)\s*$/);

    if (fence !== null) {
      if (fenceMatch) { out.push("</code></pre>"); fence = null; }
      else out.push(line + "\n");
      continue;
    }
    if (fenceMatch) {
      flushPara(); flushList();
      fence = fenceMatch[1];
      out.push(`<pre><code data-lang="${fence}">`);
      continue;
    }

    if (!line.trim()) { flushPara(); flushList(); continue; }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushPara(); flushList();
      const lvl = Math.min(heading[1].length + 1, 4);
      out.push(`<h${lvl}>${inline(heading[2])}</h${lvl}>`);
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushPara(); flushList();
      out.push(`<blockquote>${inline(line.replace(/^\s*>\s?/, ""))}</blockquote>`);
      continue;
    }

    if (/^\s*([-*+])\s+/.test(line)) {
      flushPara();
      if (list !== "ul") { flushList(); out.push("<ul>"); list = "ul"; }
      out.push(`<li>${inline(line.replace(/^\s*[-*+]\s+/, ""))}</li>`);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      flushPara();
      if (list !== "ol") { flushList(); out.push("<ol>"); list = "ol"; }
      out.push(`<li>${inline(line.replace(/^\s*\d+[.)]\s+/, ""))}</li>`);
      continue;
    }

    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      flushPara(); flushList();
      out.push("<hr>");
      continue;
    }

    flushList();
    para.push(line.trim());
  }

  if (fence !== null) out.push("</code></pre>");
  flushPara();
  flushList();
  return out.join("");
}
