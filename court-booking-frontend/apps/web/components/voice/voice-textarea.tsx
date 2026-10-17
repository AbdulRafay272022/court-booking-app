"use client";

/** STUB owned by agent W2 (A9 voice): a labelled textarea with the free continuous Web Speech mic.
 * Other agents import it for reject / cancel / refund reasons; W2 replaces the body, never the props. */
export interface VoiceTextareaProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  rows?: number;
  maxLength?: number;
}

export function VoiceTextarea({ id, label, value, onChange, required, rows = 3, maxLength }: VoiceTextareaProps) {
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} required={required} rows={rows} maxLength={maxLength} />
    </div>
  );
}
