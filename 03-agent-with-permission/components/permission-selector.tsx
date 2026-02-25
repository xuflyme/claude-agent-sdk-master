'use client';

import { useRef, useEffect, useState } from 'react';
import { Shield, Check, X, ShieldCheck, MessageCircleQuestion, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  toolUseId: string;
  input: Record<string, unknown>;
  decisionReason?: string;
  suggestions?: unknown[];
}

interface AskUserQuestionOption {
  label: string;
  description?: string;
}

interface AskUserQuestionItem {
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect: boolean;
}

interface PermissionSelectorProps {
  request: PermissionRequest;
  onDecision: (requestId: string, behavior: 'allow' | 'deny', message?: string, updatedInput?: Record<string, unknown>, updatedPermissions?: unknown[]) => void;
}

// ============================================================================
// AskUserQuestion 专用渲染
// ============================================================================

function AskUserQuestionForm({ request, onDecision }: PermissionSelectorProps) {
  const questions = (request.input.questions ?? []) as AskUserQuestionItem[];
  // answers: key = question index, value = selected label(s) or custom text
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({});
  // track which questions chose "Other"
  const [usingOther, setUsingOther] = useState<Record<string, boolean>>({});

  const handleSelect = (qIdx: number, label: string, multi: boolean) => {
    const key = String(qIdx);
    if (!multi) {
      setAnswers(prev => ({ ...prev, [key]: label }));
      setUsingOther(prev => ({ ...prev, [key]: false }));
      return;
    }
    // multi-select: toggle
    setAnswers(prev => {
      const current = prev[key] ? prev[key].split(', ') : [];
      const next = current.includes(label)
        ? current.filter(l => l !== label)
        : [...current, label];
      return { ...prev, [key]: next.join(', ') };
    });
    setUsingOther(prev => ({ ...prev, [key]: false }));
  };

  const handleOtherToggle = (qIdx: number) => {
    const key = String(qIdx);
    setUsingOther(prev => ({ ...prev, [key]: true }));
    setAnswers(prev => ({ ...prev, [key]: otherTexts[key] || '' }));
  };

  const handleOtherText = (qIdx: number, text: string) => {
    const key = String(qIdx);
    setOtherTexts(prev => ({ ...prev, [key]: text }));
    setAnswers(prev => ({ ...prev, [key]: text }));
  };

  const handleSubmit = () => {
    const updatedInput = { ...request.input, answers };
    onDecision(request.requestId, 'allow', undefined, updatedInput);
  };

  const allAnswered = questions.every((_, i) => answers[String(i)]?.trim());

  return (
    <div className="rounded-lg border-2 border-blue-500/50 bg-blue-50/10 p-3 space-y-3">
      <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 text-sm font-medium">
        <MessageCircleQuestion className="h-4 w-4" />
        <span>Agent is asking a question</span>
      </div>

      {questions.map((q, qIdx) => (
        <div key={qIdx} className="space-y-1.5">
          <p className="text-sm font-medium">{q.question}</p>
          <div className="space-y-1">
            {q.options.map((opt) => {
              const key = String(qIdx);
              const isSelected = q.multiSelect
                ? (answers[key] || '').split(', ').includes(opt.label)
                : answers[key] === opt.label && !usingOther[key];

              return (
                <label
                  key={opt.label}
                  className={`flex items-start gap-2 rounded-md border p-2 cursor-pointer transition-colors text-sm ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/30'
                      : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <input
                    type={q.multiSelect ? 'checkbox' : 'radio'}
                    name={`q-${qIdx}`}
                    checked={isSelected}
                    onChange={() => handleSelect(qIdx, opt.label, q.multiSelect)}
                    className="mt-0.5"
                  />
                  <div>
                    <span className="font-medium">{opt.label}</span>
                    {opt.description && (
                      <p className="text-xs text-muted-foreground">{opt.description}</p>
                    )}
                  </div>
                </label>
              );
            })}

            {/* Other option */}
            <label
              className={`flex items-start gap-2 rounded-md border p-2 cursor-pointer transition-colors text-sm ${
                usingOther[String(qIdx)]
                  ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/30'
                  : 'border-border hover:bg-muted/50'
              }`}
            >
              <input
                type={q.multiSelect ? 'checkbox' : 'radio'}
                name={`q-${qIdx}`}
                checked={usingOther[String(qIdx)] || false}
                onChange={() => handleOtherToggle(qIdx)}
                className="mt-0.5"
              />
              <div className="flex-1">
                <span className="font-medium">Other</span>
                {usingOther[String(qIdx)] && (
                  <Input
                    autoFocus
                    placeholder="Type your answer..."
                    value={otherTexts[String(qIdx)] || ''}
                    onChange={(e) => handleOtherText(qIdx, e.target.value)}
                    className="mt-1 h-7 text-sm"
                    onClick={(e) => e.stopPropagation()}
                  />
                )}
              </div>
            </label>
          </div>
        </div>
      ))}

      <Button
        size="sm"
        disabled={!allAnswered}
        onClick={handleSubmit}
      >
        <Send className="h-3 w-3 mr-1" /> Submit
      </Button>
    </div>
  );
}

// ============================================================================
// 通用权限选择器
// ============================================================================

function GenericPermissionSelector({ request, onDecision }: PermissionSelectorProps) {
  const [focusIndex, setFocusIndex] = useState(0);
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    buttonsRef.current[0]?.focus();
  }, [request.requestId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = (focusIndex + 1) % 3;
        setFocusIndex(next);
        buttonsRef.current[next]?.focus();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = (focusIndex + 2) % 3;
        setFocusIndex(prev);
        buttonsRef.current[prev]?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focusIndex]);

  const inputSummary = Object.entries(request.input)
    .slice(0, 3)
    .map(([k, v]) => {
      const val = typeof v === 'string'
        ? (v.length > 60 ? v.slice(0, 60) + '...' : v)
        : JSON.stringify(v);
      return `${k}: ${val}`;
    })
    .join('\n');

  return (
    <div className="rounded-lg border-2 border-amber-500/50 bg-amber-50/10 p-3 space-y-2">
      <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-sm font-medium">
        <Shield className="h-4 w-4" />
        <span>Permission Required: {request.toolName}</span>
      </div>

      {request.decisionReason && (
        <p className="text-xs text-muted-foreground">{request.decisionReason}</p>
      )}

      {inputSummary && (
        <pre className="text-xs text-muted-foreground bg-muted/50 rounded p-2 whitespace-pre-wrap overflow-hidden max-h-24">
          {inputSummary}
        </pre>
      )}

      <div className="flex gap-2">
        <Button
          ref={(el) => { buttonsRef.current[0] = el; }}
          size="sm"
          variant="outline"
          className="border-green-500/50 text-green-600 hover:bg-green-50 dark:hover:bg-green-950"
          onClick={() => onDecision(request.requestId, 'allow')}
        >
          <Check className="h-3 w-3 mr-1" /> Allow
        </Button>
        <Button
          ref={(el) => { buttonsRef.current[1] = el; }}
          size="sm"
          variant="outline"
          className="border-red-500/50 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
          onClick={() => onDecision(request.requestId, 'deny')}
        >
          <X className="h-3 w-3 mr-1" /> Deny
        </Button>
        <Button
          ref={(el) => { buttonsRef.current[2] = el; }}
          size="sm"
          variant="outline"
          className="border-blue-500/50 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950"
          onClick={() => onDecision(request.requestId, 'allow', undefined, undefined, request.suggestions)}
        >
          <ShieldCheck className="h-3 w-3 mr-1" /> Always Allow
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// 主入口：根据 toolName 路由到不同渲染
// ============================================================================

export function PermissionSelector(props: PermissionSelectorProps) {
  if (props.request.toolName === 'AskUserQuestion') {
    return <AskUserQuestionForm {...props} />;
  }
  return <GenericPermissionSelector {...props} />;
}
