// In-page confirmation box. Browser confirm() dialogs are not available everywhere
// (e.g. when the game is embedded), so every "are you sure?" goes through this.
export interface ConfirmRequest {
  text: string;
  yes: string;
  onYes: () => void;
}

export function ConfirmDialog({ req, close }: { req: ConfirmRequest; close: () => void }) {
  return (
    <div className="modal-back" role="dialog" aria-modal="true">
      <div className="modal card">
        <p>{req.text}</p>
        <div className="row">
          <button className="primary" autoFocus onClick={() => { close(); req.onYes(); }}>{req.yes}</button>
          <button onClick={close}>取消</button>
        </div>
      </div>
    </div>
  );
}
