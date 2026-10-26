"use strict";

// The style page, #/p/<project>/s/<style>: a style as a living source. The header says the model it draws with and its
// latest revision; the tabs show its rules, its references (images and texts), and its history, where every revision
// shows what changed, why, and the images drawn with it. What to change is said in the box under the page, which opens
// a thread. It follows the page-module contract in web/README.md: every poll redraws only the parts whose data changed,
// and what is expanded lives in the page's state so a redraw keeps it.

(() => {
  const state = {};

  function reset(at) {
    Object.assign(state, {
      at, data: null, tab: at.params.tab || "rules",
      signatures: {}, open: new Map(), revisions: new Map(), focus: Number(at.params.revision) || null, catalog: null
    });
    if (state.focus) state.open.set(`revision|${state.focus}`, true);
  }

  page("style", {
    enter(at) {
      reset(at);
      api("/api/catalog")
        .then(value => { if (state.at !== at) return; state.catalog = value.models; if (state.data && at === route) render(); })
        .catch(() => { if (state.at === at) state.catalog = []; });
    },
    async load(at) {
      const data = await api(`/api/style?project=${encode(at.project)}&style=${encode(at.style)}`);
      if (at !== route) return;
      state.data = data;
      render();
    }
  });

  // ---------- small helpers ----------

  const project = () => state.at.project;
  const style = () => state.data.name;
  const body = extra => ({ project: project(), style: style(), ...extra });
  const projectFile = path => inProject(project(), path);
  const ROLES = { style: t("Style"), subject: t("Subject"), composition: t("Composition") };
  const UNITS = { image: t("image"), megapixel: t("megapixel"), token: t("token") };
  const images = data => data.references.filter(reference => reference.kind === "image");
  const texts = data => data.references.filter(reference => reference.kind === "text");
  const tabs = () => [
    { value: "rules", label: t("Rules") },
    { value: "references", label: t("References"), count: state.data.references.length },
    { value: "history", label: t("History"), count: state.data.revisions.length }
  ];

  // trigger, the button that started the work, stays disabled until the page shows its result.
  async function act(work, trigger = null) {
    if (trigger) trigger.disabled = true;
    try { await work(); }
    catch (error) { toast(error.message, "error"); }
    await load();
    if (trigger) trigger.disabled = false;
  }

  // A price too small for money(), such as one per token, keeps its first two digits.
  const price = value => value >= 0.01 || value === 0 ? money(value) : `$${Number(value.toPrecision(2))}`;

  function modelEntry(model) {
    return (state.catalog || []).find(entry => entry.id === model) || null;
  }

  // What one image of a model costs: measured here when it has drawn, else its list price when billed per image.
  function costOfImage(model) {
    const entry = modelEntry(model);
    if (!entry) return null;
    if (entry.measured != null) return entry.measured;
    return entry.price && entry.price.unit === "image" && entry.price.cost != null ? entry.price.cost : null;
  }

  function priceText(entry) {
    if (!entry || !entry.price || entry.price.cost == null) return t("Unknown");
    if (entry.price.cost === 0) return t("Free");
    return `${price(entry.price.cost)} / ${UNITS[entry.price.unit] || entry.price.unit}`;
  }

  function modelSpecs(model) {
    const entry = modelEntry(model);
    if (!entry) return null;
    return [
      [t("Price"), priceText(entry)],
      entry.measured != null ? [t("Measured here"), `${price(entry.measured)} / ${t("image")}`] : null,
      [t("References"), String(entry.references)]
    ];
  }

  function sourceLabel(source) {
    return { owner: t("You"), agent: t("Agent"), migration: t("Migration"), auto: t("Recorded when drawn"), copy: t("Copy") }[source] || source;
  }

  // Where the reaction a revision answers was: a node on the canvas or a thread round.
  function originLink(origin) {
    if (!origin) return null;
    if (/^n\d+$/.test(origin)) return h("a", { href: hashes.project(project(), origin), text: t("{node} on the canvas", { node: origin }) });
    const thread = /^(t\d+)(?:\/(\d+))?$/.exec(origin);
    if (thread) return h("a", { href: hashes.thread(project(), thread[1]), text: thread[2] ? t("Thread {thread}, round {round}", { thread: thread[1], round: Number(thread[2]) }) : t("Thread {thread}", { thread: thread[1] }) });
    return h("span", { text: origin });
  }

  // A block that opens and closes, remembered by key across redraws. content() is built only while it is open.
  function disclosure(key, openByDefault, summary, content, className = "") {
    const open = state.open.has(key) ? state.open.get(key) : openByDefault;
    const node = h("details", { class: `disclosure ${className}`.trim(), open, id: key.replace("|", "-") }, [
      h("summary", {}, [h("span", { class: "disclosure-mark", html: icon("chevron") }), ...[].concat(summary)])
    ]);
    let filled = false;
    const fillOpen = () => {
      if (filled || !node.open) return;
      filled = true;
      node.append(h("div", { class: "disclosure-body" }, [content()].flat(Infinity).filter(Boolean)));
    };
    fillOpen();
    node.addEventListener("toggle", () => { state.open.set(key, node.open); fillOpen(); });
    return node;
  }

  // ---------- rendering ----------

  function build() {
    fill($("view"), h("div", { class: "page style-page", id: "style-page" }, [
      h("header", { class: "style-head", id: "style-head" }),
      h("div", { class: "style-notices", id: "style-notices" }),
      h("div", { class: "style-tabs", id: "style-tabs" }),
      h("div", { class: "style-body", id: "style-body" }),
      talkComposer({ placeholder: t("e.g. Corners look too sharp on small icons"), body: { project: project(), style: state.at.style } })
    ]));
  }

  // Each part redraws only when what it shows changed.
  function part(name, signature, draw) {
    if (state.signatures[name] === signature) return;
    state.signatures[name] = signature;
    draw();
  }

  function render(force = false) {
    const data = state.data;
    if (!$("style-page")) { build(); state.signatures = {}; }
    if (force) state.signatures.body = null;
    document.title = `${data.name} · Asset Studio`;
    if (!tabs().some(tab => tab.value === state.tab)) state.tab = "rules";
    const pick = keys => Object.fromEntries(keys.map(key => [key, data[key]]));
    part("head", signatureOf(pick(["name", "purpose", "model", "models", "revisions", "current"])), renderHead);
    part("notices", signatureOf(pick(["missing"])), renderNotices);
    part("tabs", signatureOf(tabs(), state.tab), () => fill($("style-tabs"), tabBar({ items: tabs(), value: state.tab, onChange: switchTab })));
    part("body", signatureOf(pick(TAB_DATA[state.tab]), state.tab, Boolean(state.catalog)), renderBody);
    if (state.focus) focusRevision();
  }

  // What each tab shows, so a change elsewhere does not redraw it.
  const TAB_DATA = {
    rules: ["spec"],
    references: ["references", "set_check"],
    history: ["revisions", "current"]
  };

  // The tab is kept in the address without a hashchange, so a reload or a shared link opens it and the page stays.
  function switchTab(tab) {
    state.tab = tab;
    history.replaceState(null, "", `${hashes.style(project(), style())}${tab === "rules" ? "" : `?tab=${tab}`}`);
    render();
  }

  // A link to one revision, from a node drawn with it, opens the history with that revision open.
  function focusRevision() {
    const node = $(`revision-${state.focus}`);
    state.focus = null;
    if (node) requestAnimationFrame(() => { node.scrollIntoView({ block: "start" }); node.classList.add("focused"); });
  }

  function renderHead() {
    const data = state.data;
    const latest = data.revisions.length;
    fill($("style-head"),
      linkButton(project(), hashes.project(project()), { iconName: "previous", variant: "ghost", title: t("Back") }),
      h("div", { class: "style-title" }, [
        h("div", { class: "style-name" }, [
          h("h1", { text: data.name }),
          tool("more", t("More"), event => { const box = event.currentTarget.getBoundingClientRect(); openMenu({ x: box.left, y: box.bottom + 4 }, [
            { label: t("Rename"), onClick: renameStyle },
            { label: t("Delete"), danger: true, onClick: deleteStyle }
          ]); }, { quiet: true })
        ])
      ]),
      data.purpose ? h("p", { class: "style-purpose", text: data.purpose }) : null,
      h("div", { class: "style-facts" }, [
        modelPicker(data),
        latest ? h("span", { text: t("Revision {revision}", { revision: latest }), title: data.current == null ? t("Changes since this revision are recorded when the style next draws.") : "" }) : null
      ])
    );
  }

  // The model it draws with, chosen among the models it has a prompting file for; adding one asks the agent.
  function modelPicker(data) {
    const ADD = "\u0000add";
    if (!data.models.length) return button(t("Add model"), { small: true, variant: "ghost", iconName: "plus", onClick: addModel });
    return dropdown({
      value: data.model, title: t("Model it draws with"),
      options: [...data.models.map(model => ({ value: model, label: shortModel(model), detail: model })), { value: ADD, label: t("Add model…") }],
      onChange: value => value === ADD ? addModel() : useModel(value)
    });
  }

  function renderNotices() {
    const data = state.data;
    fill($("style-notices"), data.missing ? notice(blockedReason(data)) : null);
  }

  function renderBody() {
    const data = state.data;
    const draw = { rules: rulesTab, references: referencesTab, history: historyTab }[state.tab];
    fill($("style-body"), h("div", { class: `style-tab style-tab-${state.tab}` }, [draw(data)].flat(Infinity)));
  }

  // ---------- header actions ----------

  function renameStyle() {
    return askName({
      title: t("Rename"), value: style(), confirm: t("Change"), taken: t("A style with this name already exists."),
      submit: async name => {
        if (name === style()) return;
        const renamed = await api("/api/styles/rename", body({ name }));
        location.hash = hashes.style(project(), renamed.style);
      }
    });
  }

  async function deleteStyle() {
    if (!await confirmDelete(t("Delete {name}", { name: style() }), t("Its rules, references, revisions, and threads are deleted. Images already made stay on the canvas. This cannot be undone."))) return;
    try { await api("/api/styles/delete", body()); location.hash = hashes.project(project()); }
    catch (error) { toast(error.message, "error"); }
  }

  // ---------- rules ----------

  function rulesTab(data) {
    return data.spec && data.spec.replace(/^#[^\n]*\n?/, "").trim()
      ? h("div", { class: "style-card" }, [markdownView(data.spec, {
        isOpen: heading => state.open.get(`rules|${heading}`) ?? true,
        onToggle: (heading, open) => state.open.set(`rules|${heading}`, open)
      })])
      : emptyState({ text: t("No rules yet. Say below what the style should be, and the agent writes them.") });
  }

  // ---------- references ----------

  function referencesTab(data) {
    const pictures = images(data);
    const items = pictures.map(reference => ({
      path: projectFile(reference.path), name: fileName(reference.path),
      info: reference.annotation ? [[t("Shows"), reference.annotation.shows], [t("Takes"), reference.annotation.take], [t("Ignores"), reference.annotation.ignore]] : []
    }));
    const upload = uploadButton(t("Upload references"), uploadReferences, { iconName: "upload", label: t("Upload"), variant: "ghost", accept: MATERIAL_FILES });
    upload.classList.add("small");
    const actions = h("span", { class: "row" }, [button(t("Write a text"), { small: true, variant: "ghost", iconName: "memo", onClick: writeText }), upload]);
    return [
      sectionTitle(t("References"), actions),
      data.references.length ? null : emptyState({ text: t("No references yet. Add images or texts from the canvas, or upload them. A text holds what the style keeps to, such as a palette or design tokens.") }),
      pictures.length ? setCheck(data) : null,
      pictures.length ? h("div", { class: "reference-grid" }, pictures.map((reference, index) => {
        const note = reference.annotation;
        return h("article", { class: "reference" }, [
          imageFrame(projectFile(reference.path), {
            fit: "fill", onClick: () => openLightbox(items, index),
            tools: [tool("trash", t("Remove from references"), () => removeReference(reference))]
          }),
          h("div", { class: "reference-body" }, [
            h("div", { class: "reference-head" }, [h("strong", { text: fileName(reference.path) }), note ? pill(ROLES[note.role] || note.role, { small: true, tone: note.role === "style" ? "accent" : "" }) : null]),
            note
              ? h("dl", { class: "reference-note" }, [[t("Shows"), note.shows], [t("Takes"), note.take], [t("Ignores"), note.ignore]].filter(([, value]) => value).flatMap(([label, value]) => [h("dt", { text: label }), h("dd", { text: value })]))
              : h("p", { class: "muted reference-waiting", text: t("Waiting for the agent's annotation") })
          ])
        ]);
      })) : null,
      texts(data).map(reference => h("article", { class: "style-card text-reference" }, [
        h("div", { class: "reference-head" }, [
          h("strong", { text: fileName(reference.path) }),
          pill(t("Text"), { small: true }),
          h("span", { class: "grow" }),
          tool("trash", t("Remove from references"), () => removeReference(reference), { quiet: true })
        ]),
        markdownView(reference.text)
      ]))
    ];
  }

  function setCheck(data) {
    const check = data.set_check;
    const now = images(data).map(reference => reference.path).sort();
    if (!check) return notice(t("The set has not been checked yet: the agent looks at what the image references share besides the style."));
    if (JSON.stringify(Object.keys(check.references).sort()) !== JSON.stringify(now)) return notice(t("Not checked yet since the set changed."));
    if (!check.shared.length) return notice(t("The set is varied: nothing shared besides the style."));
    return notice(t("What the image references share besides the style. The model learns what they share, so vary it across the set."), { tone: "warning", items: check.shared });
  }

  async function uploadReferences(files) {
    for (const file of files) {
      try { await api("/api/styles/references/add", body({ name: file.name, data: await readFile(file) })); }
      catch (error) { toast(error.message, "error"); }
    }
    await load();
  }

  async function writeText() {
    const text = await ask({ title: t("Write a text"), description: t("What the style keeps to, such as a palette with hex values or design tokens. It goes into the references as it is written."), placeholder: t("e.g. Coral #FF7B75 for the main shape"), confirm: t("Add") });
    if (!text || !text.trim()) return;
    await act(() => api("/api/styles/references/add", body({ name: "text.md", data: textData(text.trim() + "\n") })));
  }

  async function removeReference(reference) {
    const name = fileName(reference.path);
    if (!await ask({ title: t("Remove {name} from the references?", { name }), description: t("The style stops using it. Earlier revisions keep it, so drawing with one of them still uses it."), confirm: t("Remove"), input: null, danger: true })) return;
    await act(() => api("/api/styles/references/remove", body({ file: name })));
  }

  // ---------- models ----------

  async function useModel(model) {
    await act(async () => {
      const used = await api("/api/styles/use", body({ model }));
      toast(t("Draws with {model} from revision {revision}", { model: shortModel(model), revision: used.revision }));
    });
  }

  // Only models that take as many references as the style has images are offered; the agent writes the model's
  // prompting file in a thread opened with the request.
  async function addModel() {
    const data = state.data;
    if (!state.catalog || !state.catalog.length) {
      try { state.catalog = (await api("/api/catalog")).models; }
      catch (error) { return toast(error.message, "error"); }
    }
    const need = images(data).length;
    const offered = state.catalog.filter(entry => entry.references >= need && !data.models.includes(entry.id))
      .sort((a, b) => (costOfImage(a.id) ?? Infinity) - (costOfImage(b.id) ?? Infinity) || a.id.localeCompare(b.id));
    if (!offered.length) return toast(tn("No other model takes {count} reference.", "No other model takes {count} references.", need), "error");
    const model = await ask({
      title: t("Add model"),
      description: tn("Models that take at least {count} reference, as many images as this style has. The agent writes how the style is prompted for it.", "Models that take at least {count} references, as many images as this style has. The agent writes how the style is prompted for it.", need),
      choices: offered.map(entry => ({ value: entry.id, title: entry.name, detail: entry.id, specs: modelSpecs(entry.id).filter(Boolean).slice(1), aside: priceText(entry) })),
      confirm: t("Ask the agent"), input: null
    });
    if (!model) return;
    try { const made = await api("/api/threads", body({ message: `Add model ${model}` })); location.hash = hashes.thread(project(), made.thread); }
    catch (error) { toast(error.message, "error"); }
  }

  // ---------- history ----------

  function historyTab(data) {
    const latest = data.revisions.length;
    if (!latest) return emptyState({ text: t("No revisions yet. The first is recorded when the agent writes the rules.") });
    return [
      h("p", { class: "style-hint", text: t("Every change is a revision. Any of them can be drawn with: choose it next to the style when you write a request.") }),
      h("div", { class: "style-stack" }, [...data.revisions].reverse().map(revision => disclosure(`revision|${revision.number}`, false, [
        h("span", { class: "revision-number", text: String(revision.number) }),
        h("span", { class: "disclosure-title", text: revision.summary }),
        pill(sourceLabel(revision.source), { small: true }),
        revision.number === latest ? pill(t("Latest"), { tone: "success", small: true }) : null,
        revision.drawn.length ? h("span", { class: "muted", text: tn("{count} image", "{count} images", revision.drawn.length) }) : null,
        h("span", { class: "disclosure-time", text: when(revision.time), title: stamp(revision.time) })
      ], () => revisionDetail(revision, latest), "style-card revision")))
    ];
  }

  function revisionDetail(revision, latest) {
    const detail = state.revisions.get(revision.number);
    const top = h("div", { class: "style-actions" }, [
      revision.origin ? h("span", { class: "muted" }, [t("From") + " ", originLink(revision.origin)]) : null,
      h("span", { class: "grow" }),
      revision.number === latest ? null : button(t("Restore"), { small: true, iconName: "restore", title: t("Continue from this revision"), onClick: event => restoreRevision(revision.number, event.currentTarget) })
    ]);
    const reason = revision.reason ? h("p", { class: "revision-reason", text: revision.reason }) : null;
    const drawn = revision.drawn.length ? h("div", { class: "thumbs" }, revision.drawn.map(item => thumb(projectFile(item.path), {
      small: true, badge: item.node, title: t("{node} on the canvas", { node: item.node }), onClick: () => { location.hash = hashes.project(project(), item.node); }
    }))) : null;
    if (!detail) {
      const at = route;
      const revisions = state.revisions;
      api(`/api/revision?project=${encode(project())}&style=${encode(style())}&revision=${revision.number}`)
        .then(value => { if (at !== route || state.revisions !== revisions) return; revisions.set(revision.number, value); render(true); })
        .catch(error => { if (at === route) toast(error.message, "error"); });
      return [top, reason, drawn, h("p", { class: "muted", text: t("Loading…") })];
    }
    const pictures = detail.references.filter(item => item.kind === "image");
    const writings = detail.references.filter(item => item.kind === "text");
    return [
      top,
      reason,
      drawn ? [h("h4", { class: "revision-label", text: t("Drawn with it") }), drawn] : null,
      detail.changes.length ? [h("h4", { class: "revision-label", text: t("What changed") }), ...detail.changes.map(change => h("div", { class: "revision-change" }, [h("code", { text: change.path }), diffView(change.diff)]))] : null,
      detail.references.length ? [h("h4", { class: "revision-label", text: t("References") }), h("div", { class: "thumbs" }, [
        ...pictures.map(item => thumb(item.name, { src: objectUrl(item.object), small: true, title: item.name, badge: ROLES[(item.annotation || {}).role] || null })),
        ...writings.map(item => h("span", { class: "text-chip", title: item.text, html: icon("memo") + `<span>${escapeHtml(item.name)}</span>` }))
      ])] : null,
      disclosure(`revision-rules|${revision.number}`, false, h("span", { class: "disclosure-title", text: t("Rules at this revision") }), () => h("div", { class: "revision-spec" }, [markdownView(detail.spec, {
        isOpen: heading => state.open.get(`revision|${revision.number}|${heading}`) ?? false,
        onToggle: (heading, open) => state.open.set(`revision|${revision.number}|${heading}`, open)
      })]))
    ];
  }

  async function restoreRevision(number, trigger) {
    if (!await ask({ title: t("Restore revision {revision}?", { revision: number }), description: t("The style becomes what it was at revision {revision}, and changes from here build on it. This is recorded as a new revision, so nothing is lost.", { revision: number }), confirm: t("Restore"), input: null })) return;
    await act(async () => {
      const restored = await api("/api/styles/restore", body({ revision: number }));
      toast(t("Restored as revision {revision}", { revision: restored.revision }));
    }, trigger);
  }

})();
