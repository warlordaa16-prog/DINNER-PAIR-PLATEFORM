import { FormEvent, useState } from 'react';
import { Check, Copy, ExternalLink, Lock, Phone, ShieldCheck } from 'lucide-react';
import { apiRequest } from '../lib/api';
import {
  AttendanceStatus,
  PublicEventResponse,
  RegistrationReceipt,
  TicketCategory,
} from '../types';

interface PublicRegistrationViewProps {
  eventData: PublicEventResponse | null;
  loading: boolean;
  showDetailsFocus?: boolean;
  onGoToAssignment: (prefillRef?: string, prefillPhone?: string) => void;
  onRegistered: () => void;
}

function formatEventDate(raw: string): string {
  if (!raw) return '6th Dec · 6:00pm';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatShortDate(raw: string): string {
  if (!raw) return '6th Dec';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatShortTime(raw: string): string {
  if (!raw) return '6:00pm';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function PublicRegistrationView({
  eventData,
  loading,
  showDetailsFocus = false,
  onGoToAssignment,
  onRegistered,
}: PublicRegistrationViewProps) {
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [residence, setResidence] = useState('');
  const [ticketCategory, setTicketCategory] = useState<TicketCategory>('STUDENT');
  const [attendanceStatus, setAttendanceStatus] = useState<AttendanceStatus | ''>('');
  const [giftExchangeConsent, setGiftExchangeConsent] = useState<'yes' | 'no' | ''>('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateRef, setDuplicateRef] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<RegistrationReceipt | null>(null);
  const [copiedKey, setCopiedKey] = useState<'ref' | 'code' | null>(null);

  const event = eventData?.event;
  const summary = eventData?.summary;

  const handleCopy = async (text: string, key: 'ref' | 'code') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDuplicateRef(null);

    if (!fullName.trim() || fullName.trim().length < 2) {
      setError('Please enter your full name.');
      return;
    }
    const digits = phoneNumber.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) {
      setError('Please enter a valid telephone or WhatsApp number (7–15 digits).');
      return;
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid email address or leave this field blank.');
      return;
    }
    if (!residence.trim() || residence.trim().length < 2) {
      setError('Please enter your campus or residence location.');
      return;
    }
    if (!attendanceStatus) {
      setError('Please confirm your dinner attendance status.');
      return;
    }
    if (!giftExchangeConsent) {
      setError('Please indicate your consent for the gift exchange.');
      return;
    }

    setSubmitting(true);
    try {
      const data = await apiRequest<{ registration: RegistrationReceipt }>(
        '/api/public/register',
        {
          method: 'POST',
          body: JSON.stringify({
            fullName: fullName.trim(),
            phoneNumber: phoneNumber.trim(),
            email: email.trim(),
            residence: residence.trim(),
            ticketCategory,
            attendanceStatus,
            giftExchangeConsent: giftExchangeConsent === 'yes',
          }),
        }
      );
      setReceipt(data.registration);
      onRegistered();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unable to register.';
      setError(message);
      if (err && typeof err === 'object' && 'data' in err) {
        const errData = (err as { data?: { existingReference?: string } }).data;
        if (errData?.existingReference) {
          setDuplicateRef(errData.existingReference);
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !event) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-6 space-y-4">
            <div className="h-8 w-48 rounded bg-white/10 animate-pulse" />
            <div className="h-14 w-full rounded bg-white/10 animate-pulse" />
            <div className="h-96 w-full rounded-2xl bg-white/5 animate-pulse" />
          </div>
          <div className="lg:col-span-6">
            <div className="h-[560px] rounded-2xl bg-white/10 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-20">
      {/* Main Flyer Showcase + Registration Card Split */}
      {!showDetailsFocus && (
        <section className="mx-auto max-w-7xl px-4 pt-8 pb-14 sm:px-6 lg:px-8 lg:pt-10">
          <div className="grid gap-10 lg:grid-cols-12 lg:items-start">
            {/* Left Flyer Showcase Column */}
            <div className="lg:col-span-5 space-y-6">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-[#E5B84B]">
                  <span>{event?.organizerName || 'Manifest Association'}</span>
                  <span aria-hidden="true">·</span>
                  <span>Presents</span>
                </div>

                <h1 className="font-display text-4xl font-semibold leading-[1.05] text-[#FBF7EE] sm:text-5xl [text-wrap:balance]">
                  {event?.eventName || 'Makindye Campuses Dinner'}
                </h1>

                <p className="text-sm leading-relaxed text-stone-300">
                  Join fellow students and alumni at{' '}
                  <span className="font-semibold text-[#F5D67B]">
                    {event?.venue || 'Garden Light Hotel'}
                  </span>{' '}
                  for an evening of fine dining, fellowship, and a curated one-to-one
                  gift exchange.
                </p>
              </div>

              {/* Official Flyer Artwork Card */}
              <div className="overflow-hidden rounded-2xl border border-[#E5B84B]/50 bg-[#0D0A06] shadow-[0_20px_60px_rgba(0,0,0,0.7)]">
                <img
                  src="/assets/aistudio/Gemini_Generated_Image_er4771er4771er47_90050295.jpg"
                  alt="Manifest Association presents Makindye Campuses Dinner — 6th Dec 6:00pm at Garden Light Hotel"
                  className="w-full h-auto object-cover"
                />
              </div>

              {/* Flyer Event Summary Box + Scalloped Contact Banner */}
              <div className="rounded-2xl border border-[#E5B84B]/60 bg-[#100C07]/90 p-5 ring-1 ring-inset ring-[#E5B84B]/20 space-y-4">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wider text-[#E5B84B]">
                      Date
                    </dt>
                    <dd className="mt-0.5 font-medium text-white tabular-nums">
                      {formatShortDate(event?.eventDate || '')}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wider text-[#E5B84B]">
                      Time
                    </dt>
                    <dd className="mt-0.5 font-medium text-white tabular-nums">
                      {formatShortTime(event?.eventDate || '') || '6:00pm'}
                    </dd>
                  </div>
                  <div className="col-span-2 border-t border-[#E5B84B]/20 pt-3">
                    <dt className="text-[11px] font-semibold uppercase tracking-wider text-[#E5B84B]">
                      Venue
                    </dt>
                    <dd className="mt-0.5 font-medium text-white">
                      {event?.venue || 'Garden Light Hotel'}
                    </dd>
                  </div>
                  <div className="col-span-2 border-t border-[#E5B84B]/20 pt-3">
                    <dt className="text-[11px] font-semibold uppercase tracking-wider text-[#E5B84B]">
                      Tickets & Gift Exchange
                    </dt>
                    <dd className="mt-1 text-xs leading-relaxed text-stone-200">
                      {event?.ticketInfo ||
                        'Student Tickets: UGX 50,000 · Alumni Tickets: UGX 70,000'}
                    </dd>
                    <dd className="mt-1 text-xs text-stone-400">
                      Gift Guide: {event?.giftBudget || 'UGX 30,000 – UGX 50,000 Wrapped Gift'}
                    </dd>
                  </div>
                </dl>

                {/* Scalloped Gold Ticket Banner matching flyer */}
                <div className="gold-ticket-banner mx-auto flex items-center justify-center gap-2.5 px-6 py-2.5 text-[#090704] shadow-md">
                  <Phone className="h-4 w-4 shrink-0 fill-[#090704]" />
                  <span className="font-mono-tabular text-base font-bold tracking-wider">
                    {event?.contactPhone || '0771004906'}
                  </span>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-stone-300">
                  <span className="tabular-nums">
                    {summary?.confirmedCount ?? 0} confirmed ·{' '}
                    {summary?.pairingsPublished
                      ? 'Pairings published'
                      : `RSVP by ${formatShortDate(event?.registrationDeadline || '')}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => onGoToAssignment()}
                    className="inline-flex items-center gap-1.5 font-semibold text-[#E5B84B] hover:text-[#F5D67B] underline underline-offset-4 cursor-pointer"
                  >
                    <Lock className="h-3.5 w-3.5" />
                    Check My Assignment
                  </button>
                </div>
              </div>
            </div>

            {/* Right Obsidian & Gold Glass Registration Card */}
            <div className="lg:col-span-7">
              <div className="w-full rounded-2xl border border-[#E5B84B]/65 bg-[#100C07]/95 p-6 text-[#FBF7EE] ring-1 ring-inset ring-[#E5B84B]/20 shadow-[0_24px_80px_rgba(0,0,0,0.82)] sm:p-8">
                {receipt ? (
                  <div className="space-y-6">
                    <div className="space-y-2 border-b border-[#E5B84B]/25 pb-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
                        Registration Confirmed
                      </p>
                      <h2 className="font-display text-3xl font-semibold text-white sm:text-4xl">
                        Welcome to the table, {receipt.fullName}.
                      </h2>
                      <p className="text-sm text-stone-300">
                        Save your registration reference and personal 6-digit access code.
                        You will need them to update your RSVP or privately reveal your
                        gift exchange recipient.
                      </p>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="rounded-xl border border-[#E5B84B]/30 bg-[#080604] p-4">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-stone-400">
                            Registration Reference
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              handleCopy(receipt.registrationReference, 'ref')
                            }
                            className="inline-flex items-center gap-1 text-xs font-medium text-[#E5B84B] hover:text-white cursor-pointer"
                          >
                            {copiedKey === 'ref' ? (
                              <>
                                <Check className="h-3.5 w-3.5 text-emerald-400" />
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy className="h-3.5 w-3.5" />
                                Copy
                              </>
                            )}
                          </button>
                        </div>
                        <p className="mt-1.5 font-mono-tabular text-xl font-semibold text-white">
                          {receipt.registrationReference}
                        </p>
                      </div>

                      <div className="rounded-xl border border-[#E5B84B]/60 bg-[#1A1308] p-4">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-[#F5D67B]">
                            Personal Access Code
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              handleCopy(receipt.personalAccessCode, 'code')
                            }
                            className="inline-flex items-center gap-1 text-xs font-medium text-[#E5B84B] hover:text-white cursor-pointer"
                          >
                            {copiedKey === 'code' ? (
                              <>
                                <Check className="h-3.5 w-3.5 text-emerald-400" />
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy className="h-3.5 w-3.5" />
                                Copy
                              </>
                            )}
                          </button>
                        </div>
                        <p className="mt-1.5 font-mono-tabular text-xl font-semibold text-[#F5D67B]">
                          {receipt.personalAccessCode}
                        </p>
                      </div>
                    </div>

                    <dl className="divide-y divide-[#E5B84B]/15 text-sm border border-[#E5B84B]/25 rounded-xl bg-[#080604]/70 px-4">
                      <div className="flex justify-between py-2.5">
                        <dt className="text-stone-400">Event & Venue</dt>
                        <dd className="font-medium text-white text-right">
                          {receipt.eventName} · {receipt.venue}
                        </dd>
                      </div>
                      <div className="flex justify-between py-2.5">
                        <dt className="text-stone-400">Ticket Tier</dt>
                        <dd className="font-medium text-[#F5D67B]">
                          {receipt.ticketCategory === 'ALUMNI'
                            ? 'Alumni Ticket (UGX 70,000)'
                            : 'Student Ticket (UGX 50,000)'}
                        </dd>
                      </div>
                      <div className="flex justify-between py-2.5">
                        <dt className="text-stone-400">Attendance</dt>
                        <dd className="font-medium text-white">
                          {receipt.attendanceStatus === 'CONFIRMED'
                            ? 'Confirmed Attending'
                            : receipt.attendanceStatus === 'PENDING'
                              ? 'Not Yet Confirmed'
                              : 'Unable to Attend'}
                        </dd>
                      </div>
                      <div className="flex justify-between py-2.5">
                        <dt className="text-stone-400">Gift Exchange</dt>
                        <dd className="font-medium text-white">
                          {receipt.giftExchangeConsent
                            ? 'Participating'
                            : 'Opted Out'}
                        </dd>
                      </div>
                    </dl>

                    <div className="flex flex-col gap-3 sm:flex-row">
                      <button
                        type="button"
                        onClick={() =>
                          onGoToAssignment(
                            receipt.registrationReference,
                            phoneNumber.trim()
                          )
                        }
                        className="flex-1 rounded-lg bg-gradient-to-r from-[#C89428] via-[#E5B84B] to-[#C89428] px-4 py-3 text-sm font-bold text-[#0A0704] hover:brightness-110 transition-all cursor-pointer"
                      >
                        Go to Private Assignment Page
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setReceipt(null);
                          setFullName('');
                          setPhoneNumber('');
                          setEmail('');
                          setResidence('');
                          setTicketCategory('STUDENT');
                          setAttendanceStatus('');
                          setGiftExchangeConsent('');
                        }}
                        className="rounded-lg border border-[#E5B84B]/40 px-4 py-3 text-sm font-semibold text-[#F5D67B] hover:bg-white/5 transition-colors cursor-pointer"
                      >
                        Register Another Guest
                      </button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} noValidate className="space-y-5">
                    <div className="border-b border-[#E5B84B]/25 pb-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#E5B84B]">
                        {event?.organizerName || 'Manifest Association'} · Official RSVP
                      </p>
                      <h2 className="mt-1 font-display text-3xl font-semibold text-white sm:text-4xl">
                        {event?.eventName || 'Makindye Campuses Dinner'}
                      </h2>
                      <p className="mt-1 text-sm text-stone-300">
                        {formatEventDate(event?.eventDate || '')} ·{' '}
                        <span className="text-[#F5D67B] font-medium">
                          {event?.venue || 'Garden Light Hotel'}
                        </span>
                      </p>
                    </div>

                    {event?.eventStatus !== 'OPEN' && (
                      <div className="rounded-lg border border-amber-400/50 bg-amber-950/50 px-4 py-3 text-sm text-amber-200">
                        Registrations are currently closed for this event. If you have
                        already registered, visit My Assignment to check your status.
                      </div>
                    )}

                    {error && (
                      <div
                        role="alert"
                        className="rounded-lg border border-rose-500/50 bg-rose-950/60 px-4 py-3 text-sm text-rose-200 space-y-2"
                      >
                        <p>{error}</p>
                        {duplicateRef && (
                          <button
                            type="button"
                            onClick={() =>
                              onGoToAssignment(duplicateRef, phoneNumber.trim())
                            }
                            className="text-xs font-semibold text-[#F5D67B] underline hover:no-underline cursor-pointer"
                          >
                            Update attendance or retrieve assignment for {duplicateRef}
                          </button>
                        )}
                      </div>
                    )}

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <label
                          htmlFor="reg-fullname"
                          className="block text-xs font-semibold uppercase tracking-wide text-[#F5D67B]"
                        >
                          Full Name <span className="text-rose-400">*</span>
                        </label>
                        <input
                          id="reg-fullname"
                          type="text"
                          required
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          placeholder="e.g. Sarah Namukasa"
                          className="mt-1.5 w-full rounded-lg border border-[#E5B84B]/30 bg-[#080604] px-3.5 py-2.5 text-sm text-white placeholder:text-stone-500 focus:border-[#E5B84B] focus:outline-none focus:ring-2 focus:ring-[#E5B84B]/30"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="reg-phone"
                          className="block text-xs font-semibold uppercase tracking-wide text-[#F5D67B]"
                        >
                          Telephone / WhatsApp <span className="text-rose-400">*</span>
                        </label>
                        <input
                          id="reg-phone"
                          type="tel"
                          required
                          value={phoneNumber}
                          onChange={(e) => setPhoneNumber(e.target.value)}
                          placeholder="0771004906"
                          className="mt-1.5 w-full rounded-lg border border-[#E5B84B]/30 bg-[#080604] px-3.5 py-2.5 text-sm text-white placeholder:text-stone-500 focus:border-[#E5B84B] focus:outline-none focus:ring-2 focus:ring-[#E5B84B]/30"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="reg-email"
                          className="block text-xs font-semibold uppercase tracking-wide text-[#F5D67B]"
                        >
                          Email Address{' '}
                          <span className="text-stone-400 font-normal normal-case">
                            (Optional)
                          </span>
                        </label>
                        <input
                          id="reg-email"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="guest@example.com"
                          className="mt-1.5 w-full rounded-lg border border-[#E5B84B]/30 bg-[#080604] px-3.5 py-2.5 text-sm text-white placeholder:text-stone-500 focus:border-[#E5B84B] focus:outline-none focus:ring-2 focus:ring-[#E5B84B]/30"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label
                          htmlFor="reg-residence"
                          className="block text-xs font-semibold uppercase tracking-wide text-[#F5D67B]"
                        >
                          Campus / Residence Location <span className="text-rose-400">*</span>
                        </label>
                        <input
                          id="reg-residence"
                          type="text"
                          required
                          value={residence}
                          onChange={(e) => setResidence(e.target.value)}
                          placeholder="e.g. Makindye, Nsambya, Kansanga"
                          className="mt-1.5 w-full rounded-lg border border-[#E5B84B]/30 bg-[#080604] px-3.5 py-2.5 text-sm text-white placeholder:text-stone-500 focus:border-[#E5B84B] focus:outline-none focus:ring-2 focus:ring-[#E5B84B]/30"
                        />
                      </div>
                    </div>

                    {/* Ticket Category Selection from Flyer */}
                    <fieldset className="space-y-2">
                      <legend className="block text-xs font-semibold uppercase tracking-wide text-[#F5D67B]">
                        Ticket Category <span className="text-rose-400">*</span>
                      </legend>
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        {(
                          [
                            ['STUDENT', 'Student Ticket', 'UGX 50,000'],
                            ['ALUMNI', 'Alumni Ticket', 'UGX 70,000'],
                          ] as const
                        ).map(([value, title, price]) => (
                          <label
                            key={value}
                            className={`flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-sm cursor-pointer transition-colors ${
                              ticketCategory === value
                                ? 'border-[#E5B84B] bg-[#E5B84B]/15 text-white font-medium'
                                : 'border-[#E5B84B]/25 bg-[#080604] text-stone-300 hover:border-[#E5B84B]/50'
                            }`}
                          >
                            <span className="flex items-center gap-2.5">
                              <input
                                type="radio"
                                name="ticketCategory"
                                value={value}
                                checked={ticketCategory === value}
                                onChange={() => setTicketCategory(value)}
                                className="h-4 w-4 accent-[#E5B84B]"
                              />
                              <span>{title}</span>
                            </span>
                            <span className="font-mono-tabular text-xs font-semibold text-[#F5D67B]">
                              {price}
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    {/* Attendance Options */}
                    <fieldset className="space-y-2">
                      <legend className="block text-xs font-semibold uppercase tracking-wide text-[#F5D67B]">
                        Dinner Attendance Confirmation <span className="text-rose-400">*</span>
                      </legend>
                      <div className="grid gap-2">
                        {(
                          [
                            ['CONFIRMED', 'Yes, I confirm my attendance.'],
                            ['PENDING', 'Not yet confirmed.'],
                            ['DECLINED', 'No, I will not attend.'],
                          ] as const
                        ).map(([value, label]) => (
                          <label
                            key={value}
                            className={`flex items-center gap-3 rounded-lg border px-3.5 py-2.5 text-sm cursor-pointer transition-colors ${
                              attendanceStatus === value
                                ? 'border-[#E5B84B] bg-[#E5B84B]/15 font-medium text-white'
                                : 'border-[#E5B84B]/25 bg-[#080604] text-stone-300 hover:border-[#E5B84B]/50'
                            }`}
                          >
                            <input
                              type="radio"
                              name="attendanceStatus"
                              value={value}
                              checked={attendanceStatus === value}
                              onChange={() => setAttendanceStatus(value)}
                              className="h-4 w-4 accent-[#E5B84B]"
                            />
                            <span>{label}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    {/* Gift Exchange Consent */}
                    <fieldset className="space-y-2">
                      <legend className="block text-xs font-semibold uppercase tracking-wide text-[#F5D67B]">
                        Gift Exchange Participation Consent <span className="text-rose-400">*</span>
                      </legend>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {(
                          [
                            ['yes', 'Yes, I agree to participate.'],
                            ['no', 'No, I do not wish to participate.'],
                          ] as const
                        ).map(([value, label]) => (
                          <label
                            key={value}
                            className={`flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm cursor-pointer transition-colors ${
                              giftExchangeConsent === value
                                ? 'border-[#E5B84B] bg-[#E5B84B]/15 font-medium text-white'
                                : 'border-[#E5B84B]/25 bg-[#080604] text-stone-300 hover:border-[#E5B84B]/50'
                            }`}
                          >
                            <input
                              type="radio"
                              name="giftExchangeConsent"
                              value={value}
                              checked={giftExchangeConsent === value}
                              onChange={() => setGiftExchangeConsent(value)}
                              className="h-4 w-4 accent-[#E5B84B]"
                            />
                            <span>{label}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    <button
                      type="submit"
                      disabled={submitting || event?.eventStatus !== 'OPEN'}
                      className="w-full rounded-lg bg-gradient-to-r from-[#C89428] via-[#E5B84B] to-[#C89428] px-5 py-3.5 text-sm font-bold text-[#0A0704] shadow-lg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 transition-all cursor-pointer"
                    >
                      {submitting
                        ? 'Submitting Registration...'
                        : 'Complete Dinner Registration'}
                    </button>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-stone-400">
                      <span className="inline-flex items-center gap-1.5">
                        <ShieldCheck className="h-4 w-4 text-[#E5B84B]" />
                        Inquiries & Ticket Desk:{' '}
                        <strong className="font-mono-tabular text-stone-200">
                          {event?.contactPhone || '0771004906'}
                        </strong>
                      </span>
                      {event?.googleFormUrl && (
                        <a
                          href={event.googleFormUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-[#E5B84B] hover:text-[#F5D67B] underline"
                        >
                          Register via Google Form
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Event Details & Automated Pairing Guide */}
      <section className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
        <div className="grid gap-10 rounded-2xl border border-[#E5B84B]/35 bg-[#100C07]/90 p-6 sm:p-10 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-5 overflow-hidden rounded-xl border border-[#E5B84B]/30">
            <img
              src={
                showDetailsFocus
                  ? '/assets/aistudio/Gemini_Generated_Image_er4771er4771er47_90050295.jpg'
                  : '/src/assets/images/gift_exchange_vignette_1794920522736.jpg'
              }
              alt={
                showDetailsFocus
                  ? 'Makindye Campuses Dinner Flyer'
                  : 'Curated gift box tied with satin gold ribbon'
              }
              className="h-72 w-full object-cover sm:h-80"
            />
          </div>
          <div className="lg:col-span-7 space-y-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#E5B84B]">
                {event?.organizerName || 'Manifest Association'} · Gift Exchange Guide
              </p>
              <h2 className="mt-2 font-display text-3xl font-semibold text-white">
                {event?.eventName || 'Makindye Campuses Dinner'} — How Pairing Works
              </h2>
              <p className="mt-2 text-xs text-stone-300">
                {formatEventDate(event?.eventDate || '')} ·{' '}
                {event?.venue || 'Garden Light Hotel'} ·{' '}
                {event?.ticketInfo || 'Student Tickets: UGX 50,000 · Alumni Tickets: UGX 70,000'} ·
                RSVP Desk: {event?.contactPhone || '0771004906'}
              </p>
            </div>

            <div className="grid gap-6 sm:grid-cols-3">
              <div className="space-y-1.5">
                <p className="font-mono-tabular text-xs font-semibold text-[#E5B84B]">
                  01. Register & Confirm
                </p>
                <h3 className="text-sm font-semibold text-white">
                  Attendance & Consent
                </h3>
                <p className="text-xs leading-relaxed text-stone-300">
                  Confirmed Student and Alumni guests who opt into the gift exchange
                  enter the pairing pool.
                </p>
              </div>
              <div className="space-y-1.5">
                <p className="font-mono-tabular text-xs font-semibold text-[#E5B84B]">
                  02. Curated Pairing
                </p>
                <h3 className="text-sm font-semibold text-white">
                  Zero Self-Matches
                </h3>
                <p className="text-xs leading-relaxed text-stone-300">
                  Our randomized pairing engine runs mutual pairs or a secret
                  derangement and locks final assignments.
                </p>
              </div>
              <div className="space-y-1.5">
                <p className="font-mono-tabular text-xs font-semibold text-[#E5B84B]">
                  03. Private Reveal
                </p>
                <h3 className="text-sm font-semibold text-white">
                  Verified Access Only
                </h3>
                <p className="text-xs leading-relaxed text-stone-300">
                  Verify with your registration reference and access code to see
                  only the person you are gifting.
                </p>
              </div>
            </div>

            {showDetailsFocus && (
              <div className="pt-2 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => onGoToAssignment()}
                  className="rounded-lg bg-gradient-to-r from-[#C89428] via-[#E5B84B] to-[#C89428] px-5 py-2.5 text-xs font-bold text-[#0A0704] hover:brightness-110 transition-all cursor-pointer"
                >
                  Open Private Assignment Lookup
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
