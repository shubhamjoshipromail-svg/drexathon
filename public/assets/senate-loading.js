const stages = {
  motion: ['Checking your motion', '“Every great debate begins with a question.”'],
  documents: ['Reading your documents', '“Someone fetch the good scrolls.”'],
  opening: ['Taking opening positions', '“Give the senators a moment. They love a speech.”']
};

export function createSenateLoading(setup, form) {
  const panel = document.createElement('section');
  panel.className = 'senate-loading';
  panel.hidden = true;
  panel.setAttribute('aria-labelledby','senate-loading-stage');
  panel.innerHTML = `
    <div class="loading-caesar" aria-hidden="true">
      <img src="./assets/consul-body.png" alt="">
      <img src="./assets/consul-body-speaking.png" alt="">
    </div>
    <div class="loading-speech">
      <p class="loading-speaker">Caesar</p>
      <p class="loading-line" aria-hidden="true"></p>
      <h2 id="senate-loading-stage" role="status"></h2>
      <p class="loading-return">The chamber opens as soon as it’s ready.</p>
    </div>`;
  setup.append(panel);
  const title = panel.querySelector('h2');
  const line = panel.querySelector('.loading-line');
  return {
    show(stage) {
      form.hidden = true;
      panel.hidden = false;
      [title.textContent,line.textContent] = stages[stage];
    },
    hide() {
      panel.hidden = true;
      form.hidden = false;
    }
  };
}
