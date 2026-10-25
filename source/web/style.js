"use strict";

// The style page, #/p/<project>/s/<style>: a style as a living source. The header says what its rules include, the
// model it draws with, and its revision; the agent's open proposals stand above the tabs, each with its diff and its
// probes drawn before and after; the tabs show its rules, its references, and its history. What to change is said in
// the box under the page, which opens a thread. It follows the page-module contract in web/README.md: every poll
// redraws only the parts whose data changed, and what is expanded lives in the page's state so a redraw keeps it.

(() => {
  const state = {};

  function reset(at) {
    Object.assign(state, {
      at, data: null, tab: at.params.tab || "rules", view: "own",
      signatures: {}, open: new Map(), revisions: new Map(), focus: at.params.proposal || null, catalog: null
    });
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
  const ROLES = { style: t("Style"), subject: t("Subject"), composition: t("Composition"), guide: t("Guide") };
  const UNITS = { image: t("image"), megapixel: t("megapixel"), token: t("token") };
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

  // The words before a probe run starts: how many images, and what they should cost.
  function costLine(model, count) {
    const each = costOfImage(model);
    if (each != null) return tn("{count} image of {model} at {price}: about {total}.", "{count} images of {model} at {price} each: about {total}.", count, { model: shortModel(model), price: price(each), total: price(each * count) });
    const entry = modelEntry(model);
    if (entry && entry.price && entry.price.cost != null) return tn("{count} image of {model}, billed at {price}; the cost shows once it is drawn.", "{count} images of {model}, billed at {price}; the cost shows once they are drawn.", count, { model: shortModel(model), price: priceText(entry) });
    return tn("{count} image of {model}; its price is not known, so the cost shows once it is drawn.", "{count} images of {model}; its price is not known, so the cost shows once they are drawn.", count, { model: shortModel(model) });
  }

  function runLabel(model, count) {
    const each = costOfImage(model);
    return each != null && count ? t("Run probes · about {total}", { total: price(each * count) }) : t("Run probes");
  }

  // A proposal that changes style.json may change the model its probes draw with.
  function proposalModel(proposal) {
    const file = proposal.files.find(item => item.path === "style.json" && item.diff);
    const match = file && /^\+\s*"model":\s*"([^"]+)"/m.exec(file.diff);
    return match ? match[1] : state.data.model;
  }

  function statusPill(run) {
    if (run.status === "queued") return agentAttached() ? pill(t("Queued"), { tone: "accent", dot: "static", small: true }) : pill(t("Queued · no agent"), { dot: "static", small: true });
    if (run.status === "drawing") return pill(t("Drawing"), { tone: "accent", dot: "live", small: true });
    return pill(t("Done"), { tone: "success", small: true });
  }

  const runTarget = run => run.proposal ? t("Proposal {id}", { id: run.proposal }) : t("Revision {revision}", { revision: run.revision });

  function sourceLabel(source) {
    if ((source || "").startsWith("proposal ")) return t("Proposal {id}", { id: source.slice("proposal ".length) });
    return { owner: t("You"), agent: t("Agent"), migration: t("Migration"), auto: t("Recorded when drawn"), copy: t("Copy") }[source] || source;
  }

  // Where a proposal's reaction came from: a node on the canvas, a thread round, or the user's words.
  function sourceLink(source) {
    if (!source) return null;
    if (/^n\d+$/.test(source)) return h("a", { href: hashes.project(project(), source), text: t("{node} on the canvas", { node: source }) });
    const thread = /^(t\d+)(?:\/(\d+))?$/.exec(source);
    if (thread) return h("a", { href: hashes.thread(project(), thread[1]), text: thread[2] ? t("Thread {thread}, round {round}", { thread: thread[1], round: Number(thread[2]) }) : t("Thread {thread}", { thread: thread[1] }) });
    return h("span", { text: source });
  }

  // A block that opens and closes, remembered by key across redraws. content() is built only while it is open.
  function disclosure(key, openByDefault, summary, content, className = "") {
    const open = state.open.has(key) ? state.open.get(key) : openByDefault;
    const node = h("details", { class: `disclosure ${className}`.trim(), open }, [
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
      h("div", { class: "style-proposals", id: "style-proposals" }),
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
    part("head", signatureOf(pick(["name", "purpose", "guide", "extends", "model", "models", "revision", "current"])), renderHead);
    part("notices", signatureOf(pick(["guide", "missing", "stale_bases"])), renderNotices);
    part("proposals", signatureOf(pick(["proposals", "runs", "probes", "model", "guide"]), Boolean(state.catalog)), renderProposals);
    part("tabs", signatureOf(tabs(), state.tab), () => fill($("style-tabs"), tabBar({ items: tabs(), value: state.tab, onChange: switchTab })));
    part("body", signatureOf(pick(TAB_DATA[state.tab]), state.tab, state.view, Boolean(state.catalog)), renderBody);
    if (state.focus) focusProposal();
  }

  // What each tab shows, so a change elsewhere does not redraw it.
  const TAB_DATA = {
    rules: ["spec", "effective", "extends"],
    references: ["references", "drawn_with", "set_check", "extends"],
    history: ["revisions", "current", "runs", "probes", "model", "guide"]
  };

  // The tab is kept in the address without a hashchange, so a reload or a shared link opens it and the page stays.
  function switchTab(tab) {
    state.tab = tab;
    history.replaceState(null, "", `${hashes.style(project(), style())}${tab === "rules" ? "" : `?tab=${tab}`}`);
    render();
  }

  function focusProposal() {
    const id = state.focus;
    const proposal = state.data.proposals.find(each => each.id === id);
    state.focus = null;
    if (!proposal || proposal.status !== "open") return;
    const node = $(`proposal-${id}`);
    if (node) requestAnimationFrame(() => { node.scrollIntoView({ block: "start" }); node.classList.add("focused"); });
  }

  function renderHead() {
    const data = state.data;
    const facts = [
      data.extends.length ? h("span", {}, [t("Includes") + " ", ...data.extends.flatMap((name, index) => [index ? ", " : "", h("a", { href: hashes.style(project(), name), text: name })])]) : null,
      data.guide ? null : modelPicker(data),
      h("span", { text: t("Revision {revision}", { revision: data.revision }), title: data.current == null ? t("Changes since this revision are recorded when the style next draws.") : "" })
    ].filter(Boolean);
    fill($("style-head"),
      linkButton(project(), hashes.project(project()), { iconName: "previous", variant: "ghost", title: t("Back") }),
      h("div", { class: "style-title" }, [
        h("div", { class: "style-name" }, [
          h("h1", { text: data.name }),
          tool("more", t("More"), event => { const box = event.currentTarget.getBoundingClientRect(); openMenu({ x: box.left, y: box.bottom + 4 }, [
            { label: t("Rename"), onClick: renameStyle },
            { label: t("Styles it includes"), onClick: editExtends },
            { label: t("Delete"), danger: true, onClick: deleteStyle }
          ]); }, { quiet: true })
        ])
      ]),
      data.purpose ? h("p", { class: "style-purpose", text: data.purpose }) : null,
      h("div", { class: "style-facts" }, facts)
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
    fill($("style-notices"),
      data.missing && data.missing !== "guide" ? notice(blockedReason(data)) : null,
      data.guide ? notice(blockedReason(data)) : null,
      data.stale_bases.length ? notice(t("Base changed ({styles}): prompting and probes are behind.", { styles: data.stale_bases.join(", ") }), { tone: "warning" }) : null
    );
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
    if (!await confirmDelete(t("Delete {name}", { name: style() }), t("Its rules, references, revisions, probe runs, and threads are deleted. Images already made stay on the canvas. This cannot be undone."))) return;
    try { await api("/api/styles/delete", body()); location.hash = hashes.project(project()); }
    catch (error) { toast(error.message, "error"); }
  }

  // ---------- rules ----------

  function rulesTab(data) {
    const effective = data.extends.length > 0 && state.view === "effective";
    const text = effective ? data.effective : data.spec;
    return [
      data.extends.length ? h("div", { class: "style-toolbar" }, [
        chip(t("Its own words"), { on: !effective, onClick: () => { state.view = "own"; render(); } }),
        chip(t("Effective style"), { on: effective, onClick: () => { state.view = "effective"; render(); } })
      ]) : null,
      effective ? h("p", { class: "style-hint", text: t("What it draws with: the sections of the styles it builds on, in order, then its own. A later section replaces one of the same name; Never and Checks add up.") }) : null,
      text && text.trim()
        ? h("div", { class: "style-card" }, [markdownView(text, {
          isOpen: heading => state.open.get(`rules|${state.view}|${heading}`) ?? true,
          onToggle: (heading, open) => state.open.set(`rules|${state.view}|${heading}`, open)
        })])
        : emptyState({ text: t("No rules yet. Say below what the style should be, and the agent writes them.") })
    ];
  }

  // ---------- proposals ----------

  // Open ones that can still be accepted first, newest first; those the agent has to write again after them.
  function renderProposals() {
    const data = state.data;
    const open = data.proposals.filter(proposal => proposal.status === "open").reverse().sort((a, b) => Number(b.applies) - Number(a.applies));
    fill($("style-proposals"), open.map(proposal => proposalCard(data, proposal)));
  }

  function proposalCard(data, proposal) {
    const model = proposalModel(proposal);
    const canRun = Boolean(model) && data.probes.length > 0 && !data.guide && proposal.applies;
    return h("article", { class: "style-card proposal", id: `proposal-${proposal.id}` }, [
      h("div", { class: "proposal-head" }, [
        pill(t("The agent proposes"), { tone: "accent", small: true }),
        h("h3", { text: proposal.summary }),
        proposal.applies ? null : pill(t("Out of date"), { tone: "warning", small: true })
      ]),
      ...proposalDetail(data, proposal),
      proposal.applies ? null : notice(t("The style changed since this was written, so it can no longer be accepted. The agent will write it again on the current revision."), { tone: "warning" }),
      h("div", { class: "style-actions" }, [
        data.guide ? null : button(runLabel(model, data.probes.length), { iconName: "play", disabled: !canRun, onClick: () => runProbes(proposal) }),
        h("span", { class: "grow" }),
        button(t("Reject"), { variant: "ghost", onClick: () => rejectProposal(proposal) }),
        button(t("Accept"), { variant: "success", iconName: "check", disabled: !proposal.applies, title: proposal.applies ? t("Makes it the next revision") : t("No longer applies"), onClick: event => acceptProposal(proposal, event.currentTarget) })
      ]),
      data.guide ? null : comparison(data, proposal)
    ]);
  }

  function proposalDetail(data, proposal) {
    const images = proposal.files.filter(file => file.image);
    const texts = proposal.files.filter(file => !file.image);
    return [
      proposal.reason ? h("p", { class: "proposal-reason", text: proposal.reason }) : null,
      h("div", { class: "style-meta" }, [
        proposal.source ? h("span", {}, [t("From") + " ", sourceLink(proposal.source)]) : null,
        h("span", { text: t("Written on revision {revision}", { revision: proposal.base }) }),
        h("span", { text: when(proposal.time) })
      ]),
      proposal.conflicts.length ? notice(t("What it fights"), { tone: "warning", items: proposal.conflicts }) : null,
      ...texts.map(file => h("div", { class: "proposal-file" }, [
        h("div", { class: "proposal-file-head" }, [h("code", { text: file.path }), changePill(file.change)]),
        file.diff ? diffView(file.diff) : null
      ])),
      images.length ? h("div", { class: "proposal-file" }, [
        h("div", { class: "proposal-file-head" }, [h("span", { text: t("References") })]),
        h("div", { class: "proposal-images" }, images.map(file => h("figure", { class: `proposal-image ${file.change}` }, [
          thumb(file.path, { src: file.object ? objectUrl(file.object) : null, title: file.path }),
          h("figcaption", {}, [changePill(file.change), h("span", { text: fileName(file.path) })])
        ])))
      ]) : null
    ];
  }

  function changePill(change) {
    if (change === "added") return pill(t("Added"), { tone: "success", small: true });
    if (change === "removed") return pill(t("Removed"), { tone: "danger", small: true });
    return pill(t("Changed"), { tone: "accent", small: true });
  }

  // The proposal's latest run next to the current revision's latest finished run, request by request.
  function comparison(data, proposal) {
    const runs = data.runs.filter(run => run.proposal === proposal.id);
    const run = runs[runs.length - 1];
    if (!run) return null;
    const baseline = [...data.runs].reverse().find(each => each.status === "done" && !each.proposal);
    const head = h("div", { class: "compare-title" }, [
      h("strong", { text: t("Probes compared") }),
      statusPill(run),
      run.cost ? h("span", { class: "muted", text: money(run.cost) }) : null
    ]);
    if (run.status !== "done") {
      return h("section", { class: "compare" }, [head, h("p", { class: "muted", text: run.status === "drawing" ? t("Drawing the probes with this proposal.") : agentAttached() ? t("Waiting for the agent to start.") : t("No agent is attached, so this waits. Start one with open-package watch.") })]);
    }
    const items = [];
    const cell = (image, label) => {
      if (!image || !image.path) return h("div", { class: "probe-missing", text: t("Not in that run") });
      const index = items.push(probeItem(image, label)) - 1;
      return imageFrame(projectFile(image.path), {
        fit: "fill", onClick: () => openLightbox(items, index),
        tools: [tool("reference", t("Add to references"), () => addImage(image.path))]
      });
    };
    const before = baseline ? `${runTarget(baseline)} · ${t("Run {number}", { number: baseline.number })}` : t("Current revision");
    const after = `${runTarget(run)} · ${t("Run {number}", { number: run.number })}`;
    return h("section", { class: "compare" }, [
      head,
      run.note ? h("p", { class: "compare-note", text: run.note }) : null,
      baseline ? null : h("p", { class: "muted", text: t("No finished run of the current revision yet, so there is nothing to compare with.") }),
      h("div", { class: "compare-grid" }, [
        h("div", { class: "compare-row compare-labels" }, [h("span"), h("span", { text: before }), h("span", { text: after })]),
        ...run.images.map(image => {
          const old = baseline && baseline.images.find(each => each.request === image.request);
          return h("div", { class: "compare-row" }, [
            h("p", { class: "compare-request", text: image.request }),
            cell(old, before), cell(image, after)
          ]);
        })
      ])
    ]);
  }

  function probeItem(image, label) {
    return {
      path: projectFile(image.path),
      name: `${project()}-${style()}-${fileName(image.path)}`,
      add: () => addImage(image.path),
      info: [[t("Request"), image.request], [t("Drawn with"), label], [t("Prompt"), image.prompt, true]]
    };
  }

  async function acceptProposal(proposal, trigger) {
    await act(async () => {
      const accepted = await api("/api/proposals/accept", body({ proposal: proposal.id }));
      toast(t("Accepted as revision {revision}", { revision: accepted.revision }));
    }, trigger);
  }

  async function rejectProposal(proposal) {
    if (!await ask({ title: t("Reject {id}", { id: proposal.id }), description: t("It stays on record as rejected. To say why, tell the agent in a conversation."), confirm: t("Reject"), input: null, danger: true })) return;
    await act(() => api("/api/proposals/reject", body({ proposal: proposal.id })));
  }

  // A run of a proposal, compared with the current revision's; without one, a run of the current revision.
  async function runProbes(proposal = null) {
    const model = proposal ? proposalModel(proposal) : state.data.model;
    const description = `${costLine(model, state.data.probes.length)} ${proposal ? t("They are shown next to the current revision's run, request by request.") : ""}`.trim();
    if (!await ask({ title: proposal ? t("Run probes with {id}", { id: proposal.id }) : t("Run probes"), description, confirm: t("Run"), input: null })) return;
    await act(async () => {
      const made = await api("/api/runs", body({ proposal: proposal ? proposal.id : null }));
      toast(t("Asked for run {number}", { number: made.run }));
    });
  }

  async function addImage(path) {
    try {
      await api("/api/styles/references/add", body({ path }));
      toast(t("Added to the references of {style}", { style: style() }));
    } catch (error) {
      toast(error.message, "error");
    }
    await load();
  }

  // ---------- references ----------

  function referencesTab(data) {
    const items = data.references.map(reference => ({
      path: projectFile(reference.path), name: fileName(reference.path),
      info: reference.annotation ? [[t("Shows"), reference.annotation.shows], [t("Takes"), reference.annotation.take], [t("Ignores"), reference.annotation.ignore]] : []
    }));
    const upload = uploadButton(t("Upload references"), uploadReferences, { iconName: "upload", label: t("Upload"), variant: "ghost" });
    upload.classList.add("small");
    return [
      setCheck(data),
      sectionTitle(data.extends.length ? t("Its own references") : t("References"), upload),
      data.references.length ? h("div", { class: "reference-grid" }, data.references.map((reference, index) => {
        const note = reference.annotation;
        return h("article", { class: "reference" }, [
          imageFrame(projectFile(reference.path), {
            fit: "fill", onClick: () => openLightbox(items, index),
            tools: [tool("trash", t("Remove from references"), () => removeReference(reference.path))]
          }),
          h("div", { class: "reference-body" }, [
            h("div", { class: "reference-head" }, [h("strong", { text: fileName(reference.path) }), note ? pill(ROLES[note.role] || note.role, { small: true, tone: note.role === "style" ? "accent" : "" }) : null]),
            note
              ? h("dl", { class: "reference-note" }, [[t("Shows"), note.shows], [t("Takes"), note.take], [t("Ignores"), note.ignore]].filter(([, value]) => value).flatMap(([label, value]) => [h("dt", { text: label }), h("dd", { text: value })]))
              : h("p", { class: "muted reference-waiting", text: t("Waiting for the agent's annotation") })
          ])
        ]);
      })) : emptyState({ text: data.guide ? t("No references yet. A guide's references lend only what it covers, such as a palette swatch.") : t("No references yet. Add probe images you like, or upload images.") }),
      data.extends.length ? drawnWith(data) : null
    ];
  }

  function setCheck(data) {
    if (!data.references.length) return null;
    const check = data.set_check;
    const now = data.references.map(reference => reference.path).sort();
    if (!check) return notice(t("The set has not been checked yet: the agent looks at what the references share besides the style."));
    if (JSON.stringify(Object.keys(check.references).sort()) !== JSON.stringify(now)) return notice(t("Not checked yet since the set changed."));
    if (!check.shared.length) return notice(t("The set is varied: nothing shared besides the style."));
    return notice(t("What the references share besides the style. The model learns what they share, so vary it across the set."), { tone: "warning", items: check.shared });
  }

  function drawnWith(data) {
    return [
      sectionTitle(t("What it draws with"), String(data.drawn_with.length)),
      h("p", { class: "style-hint", text: t("Its own style references when it has any, else those of the last style it builds on that has them, and the references of every guide.") }),
      data.drawn_with.length ? h("div", { class: "drawn-grid" }, data.drawn_with.map(item => h("figure", { class: "drawn" }, [
        imageFrame(item.path ? projectFile(item.path) : null, { fit: "fill", src: item.path ? null : objectUrl(item.object) }),
        h("figcaption", {}, [
          pill(ROLES[item.role] || item.role, { small: true }),
          item.style === style() ? h("span", { text: item.name }) : h("a", { href: hashes.style(project(), item.style), text: `${item.style} · ${item.name}` })
        ])
      ]))) : h("p", { class: "muted", text: t("Nothing yet: no style it builds on has style references.") })
    ];
  }

  async function uploadReferences(files) {
    for (const file of files) {
      try { await api("/api/styles/references/add", body({ name: file.name, data: await readFile(file) })); }
      catch (error) { toast(error.message, "error"); }
    }
    await load();
  }

  async function removeReference(path) {
    if (!await ask({ title: t("Remove {name} from the references?", { name: fileName(path) }), description: t("The style stops drawing with it. Earlier revisions keep it, so restoring one brings it back."), confirm: t("Remove"), input: null, danger: true })) return;
    await act(() => api("/api/styles/references/remove", body({ file: fileName(path) })));
  }

  // ---------- models ----------

  async function useModel(model) {
    await act(async () => {
      const used = await api("/api/styles/use", body({ model }));
      toast(t("Draws with {model} from revision {revision}", { model: shortModel(model), revision: used.revision }));
    });
  }

  // Only models that take as many references as the style draws with are offered; the agent writes the model's
  // prompting file as a proposal, from a thread opened with the request.
  async function addModel() {
    const data = state.data;
    if (!state.catalog || !state.catalog.length) {
      try { state.catalog = (await api("/api/catalog")).models; }
      catch (error) { return toast(error.message, "error"); }
    }
    const need = data.drawn_with.length;
    const offered = state.catalog.filter(entry => entry.references >= need && !data.models.includes(entry.id))
      .sort((a, b) => (costOfImage(a.id) ?? Infinity) - (costOfImage(b.id) ?? Infinity) || a.id.localeCompare(b.id));
    if (!offered.length) return toast(tn("No other model takes {count} reference.", "No other model takes {count} references.", need), "error");
    const model = await ask({
      title: t("Add model"),
      description: tn("Models that take at least {count} reference, as many as this style draws with. The agent writes its prompting file and proposes it.", "Models that take at least {count} references, as many as this style draws with. The agent writes its prompting file and proposes it.", need),
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
    const runs = [...data.runs].reverse();
    return [
      h("p", { class: "style-hint", text: t("Every change is a revision, recorded on its own. Any of them can be looked at or made current again.") }),
      h("div", { class: "style-stack" }, [...data.revisions].reverse().map(revision => disclosure(`revision|${revision.number}`, false, [
        h("span", { class: "revision-number", text: String(revision.number) }),
        h("span", { class: "disclosure-title", text: revision.summary }),
        pill(sourceLabel(revision.source), { small: true }),
        revision.number === latest ? pill(t("Latest"), { tone: "success", small: true }) : null,
        h("span", { class: "disclosure-time", text: when(revision.time), title: stamp(revision.time) })
      ], () => revisionDetail(revision, latest), "style-card revision"))),
      data.guide ? null : [
        sectionTitle(t("Probe runs"), data.probes.length && data.model ? button(runLabel(data.model, data.probes.length), { small: true, variant: "ghost", iconName: "play", onClick: () => runProbes() }) : null),
        runs.length
          ? h("div", { class: "style-stack" }, runs.map((run, index) => disclosure(`run|${run.number}`, index === 0 || run.status !== "done", runSummary(run), () => runDetail(run), "style-card run")))
          : h("p", { class: "style-hint", text: t("No runs yet. A run draws every probe once, so you can see the style on subjects it has not shown.") })
      ]
    ];
  }

  function runSummary(run) {
    return [
      h("span", { class: "disclosure-title", text: t("Run {number}", { number: run.number }) }),
      pill(runTarget(run), { small: true, tone: run.proposal ? "accent" : "" }),
      statusPill(run),
      h("span", { class: "disclosure-time", text: [shortModel(run.model), when(run.time), run.cost ? money(run.cost) : null].filter(Boolean).join(" · ") })
    ];
  }

  // The run's images, each under the probe request it answers; any of them can go into the references.
  function runDetail(run) {
    if (run.images.every(image => !image.path)) {
      return run.status === "drawing" ? workingNote(t("Drawing the probes.")) : h("p", { class: "muted", text: agentAttached() ? t("Waiting for the agent to start.") : t("No agent is attached, so this waits. Start one with open-package watch.") });
    }
    const items = [];
    return [
      run.note ? h("p", { class: "run-note", text: run.note }) : null,
      h("div", { class: "probe-grid" }, run.images.map(image => h("figure", { class: "probe" }, [
        image.path ? (() => {
          const index = items.push(probeItem(image, runTarget(run))) - 1;
          return imageFrame(projectFile(image.path), { fit: "fill", onClick: () => openLightbox(items, index), tools: [tool("reference", t("Add to references"), () => addImage(image.path))] });
        })() : h("div", { class: "probe-missing", text: t("Not in that run") }),
        h("figcaption", { text: image.request })
      ])))
    ];
  }

  function revisionDetail(revision, latest) {
    const detail = state.revisions.get(revision.number);
    const parents = Object.entries(revision.parents || {});
    const top = h("div", { class: "style-actions" }, [
      parents.length ? h("span", { class: "muted", text: t("Built on {bases}", { bases: parents.map(([name, number]) => t("{style} at revision {revision}", { style: name, revision: number })).join(", ") }) }) : null,
      h("span", { class: "grow" }),
      revision.number === latest ? null : button(t("Restore"), { small: true, iconName: "restore", onClick: event => restoreRevision(revision.number, event.currentTarget) })
    ]);
    if (!detail) {
      const at = route;
      const revisions = state.revisions;
      api(`/api/revision?project=${encode(project())}&style=${encode(style())}&revision=${revision.number}`)
        .then(value => { if (at !== route || state.revisions !== revisions) return; revisions.set(revision.number, value); render(true); })
        .catch(error => { if (at === route) toast(error.message, "error"); });
      return [top, h("p", { class: "muted", text: t("Loading…") })];
    }
    return [
      top,
      detail.references.length ? h("div", { class: "thumbs" }, detail.references.map(item => thumb(item.name, { src: objectUrl(item.object), small: true, title: `${item.style} · ${item.name}`, badge: ROLES[item.role] || item.role }))) : null,
      h("div", { class: "revision-spec" }, [markdownView(detail.spec, {
        isOpen: heading => state.open.get(`revision|${revision.number}|${heading}`) ?? false,
        onToggle: (heading, open) => state.open.set(`revision|${revision.number}|${heading}`, open)
      })])
    ];
  }

  async function restoreRevision(number, trigger) {
    if (!await ask({ title: t("Restore revision {revision}?", { revision: number }), description: t("The style becomes what it was at revision {revision}. This is recorded as a new revision, so nothing is lost.", { revision: number }), confirm: t("Restore"), input: null })) return;
    await act(async () => {
      const restored = await api("/api/styles/restore", body({ revision: number }));
      toast(t("Restored as revision {revision}", { revision: restored.revision }));
    }, trigger);
  }

  // ---------- what it includes ----------

  async function editExtends() {
    let styles;
    try { styles = (await api(`/api/project?project=${encode(project())}`)).styles; }
    catch (error) { return toast(error.message, "error"); }
    const others = styles.filter(each => each.name !== style());
    if (!others.length) return toast(t("This project has no other styles."), "error");
    const picker = orderPicker({ items: others.map(each => ({ value: each.name, title: each.name, detail: each.guide ? t("Guide") : each.purpose })), chosen: state.data.extends });
    const chosen = await ask({ title: t("Styles it includes"), description: t("Its rules include the sections of these styles, in order; later ones win where sections share a name, and its own come last."), content: picker, result: () => picker.value(), confirm: t("Save"), input: null });
    if (!chosen || JSON.stringify(chosen) === JSON.stringify(state.data.extends)) return;
    await act(async () => {
      const saved = await api("/api/styles/extends", body({ extends: chosen }));
      toast(t("Saved as revision {revision}", { revision: saved.revision }));
    });
  }

})();
