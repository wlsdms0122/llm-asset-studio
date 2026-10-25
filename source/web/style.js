"use strict";

// The style page, #/p/<project>/s/<style>: a placeholder that names the style and leads back to its project, until
// the page itself is built here. It follows the page-module contract in web/README.md.

const stylePage = { signature: null };

page("style", {
  enter() { stylePage.signature = null; },
  async load(at) {
    const style = await api(`/api/style?project=${encode(at.project)}&style=${encode(at.style)}`);
    const signature = signatureOf(style);
    if (signature === stylePage.signature) return;
    stylePage.signature = signature;
    document.title = `${style.name} · Asset Studio`;
    fill($("view"), h("div", { class: "page" }, [
      linkButton(at.project, hashes.project(at.project), { iconName: "previous", variant: "ghost" }),
      h("div", { class: "page-head" }, [h("div", {}, [h("h1", { text: style.name }), style.purpose ? h("p", { text: style.purpose }) : null])]),
      emptyState({ text: t("This style's page is on its way.") })
    ]));
  }
});
