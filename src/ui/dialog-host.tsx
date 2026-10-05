import { render, type VNode } from 'preact';

/**
 * Show a Preact dialog or popup that answers once (BACKLOG 15.4). `build`
 * gets `done`; calling it unmounts the dialog and resolves the promise with
 * the answer. The dialog renders into its own host on <body>, outside the
 * app's tree, so callers keep a plain `await openX()`.
 */
export function showDialog<T>(build: (done: (answer: T) => void) => VNode): Promise<T> {
  return new Promise(resolve => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let answered = false;
    const done = (answer: T) => {
      if (answered) return;
      answered = true;
      render(null, host);
      host.remove();
      resolve(answer);
    };
    render(build(done), host);
  });
}
