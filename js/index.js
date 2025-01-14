/* global Viz */

import Flash from './Flash.js';
import Store from './Store.js';
import {$, $$, tagElement, entryFromKey, report} from './util.js';
import {isInScope, startingModules} from './scope.js';

// HACK: So we can call closest() on event targets without having to worry about
// whether or not the user clicked on an Element v. Text Node
Text.prototype.closest = function(...args) {
  return this.parentNode.closest && this.parentNode.closest(...args);
};

// Used to feature-detect that es6 modules are loading
window.indexLoaded = true;

window.addEventListener('error', err => {
  console.error(err);
  Flash(err.message);
});

window.addEventListener('unhandledrejection', err => {
  console.error(err);
  Flash(err.reason);
});

function zoom(op) {
  const svg = $('svg');
  if (!svg) return;

  const vb = svg.getAttribute('viewBox').split(' ');

  switch (op) {
    case 0:
      svg.setAttribute('width', vb[2]);
      svg.setAttribute('height', vb[3]);
      break;

    case 1:
      svg.setAttribute('width', '100%');
      svg.removeAttribute('height');
      break;

    case 2:
      svg.removeAttribute('width');
      svg.setAttribute('height', '100%');
      break;
  }
}

async function graph() {
  // Clear out graphs
  $$('svg').forEach(el => el.remove());

  const FONT='Roboto Condensed, sans-serif';

  // Compose directed graph document (GraphViz notation)
  const nodes = ['\n// Nodes & per-node styling'];
  const edges = ['\n// Edges & per-edge styling'];
  const latest = {};

  const seen = {};
  function render(m) {
    if (Array.isArray(m)) {
      return Promise.all(m.map(render));
    }

    if (m.key in seen) return;
    seen[m.key] = true;

    if (isInScope(m)) {
      nodes.push(`"${m}"`);

      const deps = {
        ...m.package.dependencies,
        ...m.package.devDependencies,
        ...m.package.peerDependencies
      };
      if (deps) {
        const renderP = [];
        for (const dep in deps) {
          renderP.push(
            Store.getModule(dep, deps[dep])
              .then(dst => {
                if (isInScope(dst)) {
                  edges.push(`"${m}" -> "${dst}"`);
                  return render(dst);
                }
              }),
            Store.getModule(dep)
              .then(dst => {
                if (isInScope(dst)) {
                  latest[dst.key] = true;
                  return render(dst);
                }
              })
          );
        }

        return Promise.all(renderP);
      }
    }

    return Promise.resolve();
  }

  $('#progress').style.display = 'block';
  let modules = startingModules;
  modules.sort();

  modules = await Promise.all(modules.map(moduleName =>
    Store.getModule(...entryFromKey(moduleName))
  ));
  modules.forEach(m => { latest[m.key] = true })
  await render(modules);
  $('#progress').style.display = 'none';

  const dotDoc = [
    'digraph {',
    'rankdir="LR"',
    'labelloc="t"',
    'label="@first-lego-league package dependency"',
    '// Default styles',
    `graph [fontsize=16 fontname="${FONT}"]`,
    `node [shape=box style=rounded fontname="${FONT}" fontsize=11 height=0 width=0 margin=.04]`,
    `edge [fontsize=10, fontname="${FONT}" splines="polyline"]`,
    ''
  ]
    .concat(nodes)
    .concat(edges)
    // .concat(
    //   modules.length > 1 ?
    //     `{rank=same; ${modules.map(s => `"${s}"`).join('; ')};}` :
    //     ''
    // )
    .concat('}')
    .join('\n');

  // https://github.com/mdaines/viz.js/ is easily the most underappreciated JS
  // library on the internet.
  const dot = Viz(dotDoc, {
    format: 'svg',
    scale: 1,
    totalMemory: 32 * 1024 * 1024 // See https://github.com/mdaines/viz.js/issues/89
  });

  // We could just `$('#graph').innerHTML = dot` here, but we want to finesse
  // the svg DOM a bit, so we parse it into a DOMFragment and then add it.
  const svg = new DOMParser().parseFromString(dot, 'text/html').querySelector('svg');
  svg.querySelectorAll('g title').forEach(el => el.remove());

  // Round up viewbox
  svg.setAttribute('viewBox', svg.getAttribute('viewBox').split(' ').map(Math.ceil).join(' '));

  $('#graph').appendChild(svg);
  zoom(1);

  $$('.progress').forEach(el => el.remove());
  $$('g.node').forEach(async el => {
    const key = $(el, 'text').textContent;
    if (!key) return;

    const moduleName = key.replace(/@[\d.]+$/, '');
    if (moduleName) {
      tagElement(el, 'module', moduleName);
    } else {
      report.warn(Error(`Bad replace: ${key}`));
    }

    const m = await Store.getModule(...entryFromKey(key));
    const pkg = m && m.package;
    if (pkg.stub) {
      el.classList.add('stub');
    } else {
      if (!latest[m.key]) {
        el.classList.add('latest');
      }

      tagElement(el, 'maintainer', ...pkg.maintainers.map(m => m.name));
      tagElement(el, 'license', m.licenseString || 'Unspecified');
    }
  });

  const names = modules.map(m => m.package.name).join(', ');
  $('title').innerText = `NPMGraph - ${names}`;
}

window.onpopstate = function(event) {
  const state = event && event.state;
  if (state && state.module) {
    graph();
    return;
  }
  graph();
};

onload = function() {
  $$('#tabs .button').forEach((button, i) => {
    if (!i) button.onclick();
  });

  $$('section > h2').forEach(el => {
    el.onclick = () => el.closest('section').classList.toggle('closed');
  });

  $('#zoomWidthButton').onclick = () => zoom(1);
  $('#zoomDefaultButton').onclick = () => zoom(0);
  $('#zoomHeightButton').onclick = () => zoom(2);

  Store.init();

  // Show storage
  let chars = 0;
  const ls = localStorage;
  for (let i = 0; i < ls.length; i++) chars += ls.getItem(ls.key(i)).length;

  onpopstate();
};
