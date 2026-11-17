import { FormEvent, useEffect, useState } from 'react';
import { Calendar, Gift, KeyRound, Lock, MapPin, Phone, RefreshCw, ShieldCheck } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { AssignmentVerificationResponse, AttendanceStatus } from '../types';

interface PrivateAssignmentViewProps {
  initialRef?: string;
  initialPhone?: string;
  onGoToRegister: () => void;
}

function formatDate(raw: string): string {
  if (!raw) return 'TBA';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function PrivateAssignmentView({
  initialRef = '',
  initialPhone = '',
  onGoToRegister,
}: PrivateAssignmentViewProps) {
  const [registrationReference, setRegistrationReference] = useState(initialRef);
  const [phoneNumber, setPhoneNumber] = useState(initialPhone);
  const [verificationCode, setVerificationCode] = useState('');

  const [verifying, setVerifying] = useState(false);
  const [requestingOtp, setRequestingOtp] = useState(false);
  const [otpNotice, setOtpNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AssignmentVerificationResponse | null>(null);

  // Attendance update states when unlocked
  const [updatingAttendance, setUpdatingAttendance] = useState(false);
  const [newAttendance, setNewAttendance] = useState<AttendanceStatus>('CONFIRMED');
  const [newConsent, setNewConsent] = useState<boolean>(true);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);

  useEffect(() => {
    if (initialRef) setRegistrationReference(initialRef);
    if (initialPhone) setPhoneNumber(initialPhone);
  }, [initialRef, initialPhone]);

  const handleRequestOtp = async () => {
    setError(null);
    setOtpNotice(null);
    if (!registrationReference.trim() || !phoneNumber.trim()) {
      setError('Enter your registration reference and telephone number first to request a verification code.');
      return;
    }

    setRequestingOtp(true);
    try {
      const data = await apiRequest<{ message: string }>(
        '/api/public/assignment/request-otp',
        {
          method: 'POST',
          body: JSON.stringify({
            registrationReference: registrationReference.trim(),
            phoneNumber: phoneNumber.trim(),
          }),
        }
      );
      setOtpNotice(data.message);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not issue verification code.');
    } finally {
      setRequestingOtp(false);
    }
  };

  const handleVerify = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setUpdateMsg(null);

    if (!registrationReference.trim() || !phoneNumber.trim() || !verificationCode.trim()) {
      setError('Please complete all three verification fields.');
      return;
    }

    setVerifying(true);
    try {
      const data = await apiRequest<AssignmentVerificationResponse>(
        '/api/public/assignment/verify',
        {
          method: 'POST',
          body: JSON.stringify({
            registrationReference: registrationReference.trim(),
            phoneNumber: phoneNumber.trim(),
            verificationCode: verificationCode.trim(),
          }),
        }
      );
      setResult(data);
      setNewAttendance(data.participant.attendanceStatus);
      setNewConsent(data.participant.giftExchangeConsent);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setVerifying(false);
    }
  };

  const handleAttendanceUpdate = async (e: FormEvent) => {
    e.preventDefault();
    setUpdatingAttendance(true);
    setUpdateMsg(null);
    setError(null);

    try {
      const data = await apiRequest<{
        message: string;
        attendanceStatus: AttendanceStatus;
        giftExchangeConsent: boolean;
      }>('/api/public/attendance', {
        method: 'PATCH',
        body: JSON.stringify({
          registrationReference: registrationReference.trim(),
          phoneNumber: phoneNumber.trim(),
          verificationCode: verificationCode.trim(),
          attendanceStatus: newAttendance,
          giftExchangeConsent: newConsent,
        }),
      });

      setResult((prev) =>
        prev
          ? {
              ...prev,
              participant: {
                ...prev.participant,
                attendanceStatus: data.attendanceStatus,
                giftExchangeConsent: data.giftExchangeConsent,
              },
            }
          : null
      );
      setUpdateMsg(data.message);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to update attendance.');
    } finally {
      setUpdatingAttendance(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:py-16">
      {!result ? (
        <div className="rounded-2xl border border-[#E5B84B]/60 bg-[#100C07]/95 p-6 text-[#FBF7EE] ring-1 ring-inset ring-[#E5B84B]/20 shadow-[0_24px_80px_rgba(0,0,0,0.82)] sm:p-10">
          <div className="border-b border-[#E5B84B]/25 pb-6">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#E5B84B]">
              <Lock className="h-3.5 w-3.5" />
              <span>Private Verification</span>
            </div>
            <h1 className="mt-2 font-display text-3xl font-semibold text-white sm:text-4xl">
              Retrieve Your Gift Assignment
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-stone-300">
              Verify your identity using your registration reference, registered
              telephone number, and your 6-digit personal access code or one-time
              verification code.
            </p>
          </div>

          <form onSubmit={handleVerify} className="mt-6 space-y-5">
            {error && (
              <div
                role="alert"
                className="rounded-lg border border-rose-500/50 bg-rose-950/60 px-4 py-3 text-sm text-rose-200"
              >
                {error}
              </div>
            )}

            {otpNotice && (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/50 px-4 py-3 text-sm text-emerald-200">
                {otpNotice}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="lookup-ref"
                  className="block text-xs font-semibold uppercase tracking-wide text-[#F5D67B]"
                >
                  Registration Reference
                </label>
                <input
                  id="lookup-ref"
                  type="text"
                  value={registrationReference}
                  onChange={(e) => setRegistrationReference(e.target.value.toUpperCase())}
                  placeholder="DP-2026-0001"
                  className="mt-1.5 w-full rounded-lg border border-[#E5B84B]/30 bg-[#080604] px-3.5 py-2.5 font-mono-tabular text-sm text-white placeholder:text-stone-500 focus:border-[#E5B84B] focus:outline-none focus:ring-2 focus:ring-[#E5B84B]/30"
                />
              </div>

              <div>
                <label
                  htmlFor="lookup-phone"
                  className="block text-xs font-semibold uppercase tracking-wide text-[#F5D67B]"
                >
                  Registered Telephone
                </label>
                <input
                  id="lookup-phone"
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="0771004906"
                  className="mt-1.5 w-full rounded-lg border border-[#E5B84B]/30 bg-[#080604] px-3.5 py-2.5 text-sm text-white placeholder:text-stone-500 focus:border-[#E5B84B] focus:outline-none focus:ring-2 focus:ring-[#E5B84B]/30"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="lookup-code"
                  className="block text-xs font-semibold uppercase tracking-wide text-[#F5D67B]"
                >
                  6-Digit Access Code / One-Time OTP
                </label>
                <button
                  type="button"
                  onClick={handleRequestOtp}
                  disabled={requestingOtp}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#E5B84B] underline hover:no-underline cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`h-3 w-3 ${requestingOtp ? 'animate-spin' : ''}`} />
                  {requestingOtp ? 'Requesting...' : 'Request New One-Time Code'}
                </button>
              </div>
              <input
                id="lookup-code"
                type="text"
                inputMode="numeric"
                maxLength={8}
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value)}
                placeholder="Enter 6-digit code"
                className="mt-1.5 w-full rounded-lg border border-[#E5B84B]/30 bg-[#080604] px-3.5 py-2.5 font-mono-tabular text-base tracking-widest text-white placeholder:text-stone-500 placeholder:tracking-normal focus:border-[#E5B84B] focus:outline-none focus:ring-2 focus:ring-[#E5B84B]/30"
              />
            </div>

            <button
              type="submit"
              disabled={verifying}
              className="w-full rounded-lg bg-gradient-to-r from-[#C89428] via-[#E5B84B] to-[#C89428] px-5 py-3.5 text-sm font-bold text-[#0A0704] hover:brightness-110 disabled:opacity-50 transition-all cursor-pointer"
            >
              {verifying ? 'Verifying Credentials...' : 'Unlock My Private Assignment'}
            </button>
          </form>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[#E5B84B]/20 pt-5 text-xs text-stone-400">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-[#E5B84B]" />
              Only your individual gift recipient is ever displayed.
            </span>
            <button
              type="button"
              onClick={onGoToRegister}
              className="font-semibold text-[#F5D67B] underline hover:no-underline cursor-pointer"
            >
              Need to register?
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Celebratory Private Assignment Card */}
          <div className="rounded-2xl border border-[#E5B84B]/65 bg-[#100C07]/95 p-6 text-white ring-1 ring-inset ring-[#E5B84B]/20 shadow-2xl sm:p-10">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E5B84B]/20 pb-5">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[#E5B84B]">
                <Gift className="h-4 w-4" />
                <span>YOUR GIFT ASSIGNMENT</span>
              </div>
              <span className="font-mono-tabular text-xs text-stone-300">
                Ref: {result.participant.registrationReference} ·{' '}
                {result.participant.ticketCategory === 'ALUMNI' ? 'Alumni' : 'Student'}
              </span>
            </div>

            {result.assignment ? (
              <div className="py-8 text-center space-y-5">
                <p className="text-sm font-medium uppercase tracking-widest text-emerald-300">
                  Congratulations!
                </p>
                <p className="text-base text-stone-300">
                  {result.participant.fullName}, you have been assigned to gift:
                </p>
                <div className="mx-auto max-w-lg rounded-xl border border-[#E5B84B]/60 bg-[#080604] px-6 py-7">
                  <p className="font-display text-4xl font-semibold tracking-tight text-[#F5D67B] sm:text-5xl">
                    {result.assignment.assignedRecipientName}
                  </p>
                  <p className="mt-3 text-xs text-stone-400">
                    {result.assignment.pairingMode === 'MUTUAL'
                      ? 'Mutual Gift Pairing · Locked Assignment'
                      : 'Secret Gift Exchange · Locked Assignment'}
                  </p>
                </div>
                <p className="mx-auto max-w-md text-xs leading-relaxed text-stone-400">
                  Please keep your match confidential until the dinner celebration.
                  Bring your wrapped gift aligned with the suggested budget below.
                </p>
              </div>
            ) : (
              <div className="py-8 text-center space-y-4">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-[#E5B84B]/30 bg-white/5 text-[#E5B84B]">
                  <KeyRound className="h-5 w-5" />
                </div>
                <h2 className="font-display text-3xl font-semibold text-white">
                  Assignment Not Yet Published
                </h2>
                <p className="mx-auto max-w-md text-sm leading-relaxed text-stone-300">
                  {result.participant.attendanceStatus !== 'CONFIRMED'
                    ? 'Your dinner attendance is not currently confirmed. Confirm your attendance below to become eligible for the gift pairing pool.'
                    : !result.participant.giftExchangeConsent
                      ? 'You opted out of the gift exchange during registration. You may update your consent below before pairings are locked.'
                      : 'Your registration and gift exchange consent are confirmed. Your private assignment will appear here once the event administrator locks the pairings.'}
                </p>
              </div>
            )}

            {/* Event Information Summary */}
            <div className="mt-4 grid gap-4 border-t border-[#E5B84B]/20 pt-6 sm:grid-cols-3 text-sm">
              <div className="flex items-start gap-3">
                <Calendar className="mt-0.5 h-4 w-4 text-[#E5B84B] shrink-0" />
                <div>
                  <p className="text-xs text-stone-400">Event & Date</p>
                  <p className="font-medium text-white">{result.event.eventName}</p>
                  <p className="text-xs text-stone-300 tabular-nums">
                    {formatDate(result.event.eventDate)}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-4 w-4 text-[#E5B84B] shrink-0" />
                <div>
                  <p className="text-xs text-stone-400">Venue & Gift Guide</p>
                  <p className="font-medium text-white">{result.event.venue}</p>
                  <p className="text-xs text-stone-300">
                    {result.event.giftBudget}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Phone className="mt-0.5 h-4 w-4 text-[#E5B84B] shrink-0" />
                <div>
                  <p className="text-xs text-stone-400">Organizer & Inquiries</p>
                  <p className="font-medium text-white">{result.event.organizerName}</p>
                  <p className="font-mono-tabular text-xs text-[#F5D67B]">
                    {result.event.contactPhone}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Self-Service Attendance Update (when allowed and not yet locked into an assignment) */}
          {result.event.allowAttendanceUpdates && !result.assignment && (
            <div className="rounded-2xl border border-[#E5B84B]/45 bg-[#100C07]/95 p-6 text-[#FBF7EE] shadow-lg sm:p-8">
              <h3 className="font-display text-2xl font-semibold text-white">
                Update Attendance & Gift Consent
              </h3>
              <p className="mt-1 text-sm text-stone-300">
                Changes made before pairings are locked take effect immediately.
              </p>

              {updateMsg && (
                <div className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-950/50 px-4 py-3 text-sm text-emerald-200">
                  {updateMsg}
                </div>
              )}
              {error && (
                <div className="mt-4 rounded-lg border border-rose-500/40 bg-rose-950/50 px-4 py-3 text-sm text-rose-200">
                  {error}
                </div>
              )}

              <form onSubmit={handleAttendanceUpdate} className="mt-5 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-[#F5D67B]">
                      Attendance Status
                    </label>
                    <select
                      value={newAttendance}
                      onChange={(e) => setNewAttendance(e.target.value as AttendanceStatus)}
                      className="mt-1.5 w-full rounded-lg border border-[#E5B84B]/30 bg-[#080604] px-3 py-2.5 text-sm text-white"
                    >
                      <option value="CONFIRMED">Yes, I confirm my attendance.</option>
                      <option value="PENDING">Not yet confirmed.</option>
                      <option value="DECLINED">No, I will not attend.</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-[#F5D67B]">
                      Gift Exchange Consent
                    </label>
                    <select
                      value={newConsent ? 'yes' : 'no'}
                      onChange={(e) => setNewConsent(e.target.value === 'yes')}
                      className="mt-1.5 w-full rounded-lg border border-[#E5B84B]/30 bg-[#080604] px-3 py-2.5 text-sm text-white"
                    >
                      <option value="yes">Yes, I agree to participate.</option>
                      <option value="no">No, I do not wish to participate.</option>
                    </select>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={updatingAttendance}
                    className="rounded-lg bg-gradient-to-r from-[#C89428] via-[#E5B84B] to-[#C89428] px-5 py-2.5 text-xs font-bold text-[#0A0704] hover:brightness-110 disabled:opacity-50 cursor-pointer"
                  >
                    {updatingAttendance ? 'Saving...' : 'Save Attendance Update'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setResult(null);
                      setVerificationCode('');
                    }}
                    className="text-xs font-semibold text-stone-300 hover:text-white underline cursor-pointer"
                  >
                    Sign Out / Check Another Reference
                  </button>
                </div>
              </form>
            </div>
          )}

          {(!result.event.allowAttendanceUpdates || result.assignment) && (
            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setResult(null);
                  setVerificationCode('');
                }}
                className="text-xs font-semibold text-stone-300 hover:text-white underline cursor-pointer"
              >
                Close & Verify Another Registration
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
