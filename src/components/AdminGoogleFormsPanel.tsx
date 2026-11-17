import { useState } from 'react';
import { ExternalLink, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { apiRequest } from '../lib/api';
import {
  getCachedGoogleAccessToken,
  signInWithGoogleWorkspace,
} from '../lib/firebase';

interface AdminGoogleFormsPanelProps {
  linkedFormId: string | null | undefined;
  linkedFormUrl: string | null | undefined;
  onSynced: () => void;
}

export function AdminGoogleFormsPanel({
  linkedFormId,
  linkedFormUrl,
  onSynced,
}: AdminGoogleFormsPanelProps) {
  const [googleToken, setGoogleToken] = useState<string | null>(() =>
    getCachedGoogleAccessToken()
  );
  const [formInput, setFormInput] = useState(linkedFormId || '');
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState<'create' | 'sync' | null>(null);
  const [confirmCreateOpen, setConfirmCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const handleConnectGoogle = async () => {
    setError(null);
    setStatusMsg(null);
    setConnecting(true);
    try {
      const res = await signInWithGoogleWorkspace();
      if (!res.accessToken) {
        setError('Google sign-in completed, but no Google Forms access token was returned.');
        return;
      }
      setGoogleToken(res.accessToken);
      setStatusMsg(`Connected Google Workspace (${res.user.email || 'authorized'}).`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Google Workspace sign-in failed.');
    } finally {
      setConnecting(false);
    }
  };

  const executeCreateForm = async () => {
    setConfirmCreateOpen(false);
    if (!googleToken) return;
    setBusy('create');
    setError(null);
    setStatusMsg(null);

    try {
      const data = await apiRequest<{ formId: string; responderUri?: string }>(
        '/api/admin/google-forms/create',
        {
          method: 'POST',
          headers: { 'X-Google-Access-Token': googleToken },
        }
      );
      setFormInput(data.formId);
      setStatusMsg(
        `Created and linked Google Form (${data.formId}). Guests can now submit responses there, and you can sync them anytime.`
      );
      onSynced();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create Google Form.');
    } finally {
      setBusy(null);
    }
  };

  const handleSyncResponses = async () => {
    if (!googleToken) {
      setError('Connect your Google account first to sync responses.');
      return;
    }
    const target = formInput.trim() || linkedFormId || '';
    if (!target) {
      setError('Enter a Google Form ID or URL, or create a new Dinner Pair Google Form first.');
      return;
    }

    setBusy('sync');
    setError(null);
    setStatusMsg(null);

    try {
      const data = await apiRequest<{
        formId: string;
        totalResponses: number;
        importedCount: number;
        updatedCount: number;
        skippedCount: number;
      }>('/api/admin/google-forms/sync', {
        method: 'POST',
        headers: { 'X-Google-Access-Token': googleToken },
        body: JSON.stringify({ formId: target }),
      });

      setFormInput(data.formId);
      setStatusMsg(
        `Synced ${data.totalResponses} Google Form response(s): ${data.importedCount} new, ${data.updatedCount} updated, ${data.skippedCount} skipped.`
      );
      onSynced();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to sync Google Form responses.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl border border-[#E5B84B]/25 bg-[#100C07]/90 p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#E5B84B]">
            <FileSpreadsheet className="h-4 w-4" />
            <span>Google Forms Sync</span>
          </div>
          <p className="text-xs text-slate-300">
            Create a structured Google Form for your dinner or import responses from an
            existing Google Form directly into the participant database.
          </p>
        </div>

        {linkedFormUrl && (
          <a
            href={linkedFormUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/10 whitespace-nowrap shrink-0"
          >
            Open Linked Form
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-950/50 px-3.5 py-2.5 text-xs text-rose-200">
          {error}
        </div>
      )}

      {statusMsg && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/50 px-3.5 py-2.5 text-xs text-emerald-200">
          {statusMsg}
        </div>
      )}

      {!googleToken ? (
        <div className="max-w-xs pt-1">
          <button
            type="button"
            onClick={handleConnectGoogle}
            disabled={connecting}
            className="gsi-material-button"
          >
            <div className="gsi-material-button-content-wrapper">
              <div className="gsi-material-button-icon">
                <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style={{ display: 'block' }}>
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                </svg>
              </div>
              <span className="gsi-material-button-contents">
                {connecting ? 'Connecting Google...' : 'Sign in with Google'}
              </span>
            </div>
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="text"
            value={formInput}
            onChange={(e) => setFormInput(e.target.value)}
            placeholder="Paste Google Form ID or https://docs.google.com/forms/d/..."
            className="flex-1 rounded-lg border border-[#E5B84B]/25 bg-[#080604] px-3.5 py-2 text-xs text-white placeholder:text-stone-500 focus:border-[#E5B84B] focus:outline-none"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSyncResponses}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#E5B84B] px-3.5 py-2 text-xs font-bold text-[#0A0704] hover:bg-[#F2CE6B] disabled:opacity-50 whitespace-nowrap cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy === 'sync' ? 'animate-spin' : ''}`} />
              {busy === 'sync' ? 'Syncing...' : 'Sync Responses'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmCreateOpen(true)}
              disabled={busy !== null}
              className="rounded-lg border border-[#E5B84B]/30 bg-white/5 px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-50 whitespace-nowrap cursor-pointer"
            >
              {busy === 'create' ? 'Creating Form...' : 'Create New Google Form'}
            </button>
          </div>
        </div>
      )}

      {/* Explicit User Confirmation Modal before Mutating Google Workspace */}
      {confirmCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-md rounded-xl border border-[#E5B84B]/40 bg-[#100C07] p-6 text-white shadow-2xl space-y-4">
            <h3 className="font-display text-2xl font-semibold">
              Create Google Form in Your Drive?
            </h3>
            <p className="text-sm leading-relaxed text-stone-300">
              This will create a new Google Form in your connected Google account with
              all 7 Dinner Pair registration fields (Full Name, Phone, Email,
              Residence, Ticket Category, Attendance Confirmation, and Gift Exchange
              Consent) and link it to the active event.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmCreateOpen(false)}
                className="rounded-lg border border-white/15 px-4 py-2 text-xs font-semibold text-stone-200 hover:bg-white/10 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeCreateForm}
                className="rounded-lg bg-[#E5B84B] px-4 py-2 text-xs font-bold text-[#0A0704] hover:bg-[#F2CE6B] cursor-pointer"
              >
                Confirm & Create Form
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
