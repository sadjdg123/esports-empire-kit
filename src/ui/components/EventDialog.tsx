import type { ChibiLook } from '../../render/pixel/chibi';
import { Portrait } from './Portrait';

export interface DialogLine {
  key: string;
  speaker: string;
  look: ChibiLook;
  text: string;
  action?: { label: string; run: () => void };
  dismiss: () => void;
}

/** A character speaking at the bottom of the screen. */
export function EventDialog({ line }: { line: DialogLine }) {
  return (
    <div className="event-dialog" role="status">
      <Portrait look={line.look} size={52} />
      <div className="event-text">
        <b>{line.speaker}</b>
        <p>{line.text}</p>
        <div className="row">
          {line.action && <button className="primary small" onClick={line.action.run}>{line.action.label}</button>}
          <button className="small" onClick={line.dismiss}>知道了</button>
        </div>
      </div>
    </div>
  );
}
