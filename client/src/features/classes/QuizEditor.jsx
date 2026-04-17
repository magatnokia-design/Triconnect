import { useRef, useState } from 'react';
import mammoth from 'mammoth';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { supabase } from '../../config/supabase';
import { useAuthStore } from '../../store/authStore';
import {
  Plus, Trash2, ChevronUp, ChevronDown,
  Check, Clock, Calendar, Code2, AlignLeft,
  ToggleLeft, List, Upload, FileDown, AlertTriangle
} from 'lucide-react';

const QUESTION_TYPES = [
  { value: 'multiple_choice', label: 'Multiple Choice', icon: List },
  { value: 'true_false', label: 'True or False', icon: ToggleLeft },
  { value: 'identification', label: 'Identification', icon: AlignLeft },
  { value: 'trace_error', label: 'Trace the Error', icon: Code2 },
];

const STRICT_IMPORT_CODES = new Set(['missing_answer', 'invalid_options']);

function parseDocxQuestions(rawText) {
  const lines = rawText
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const questions = [];
  const warnings = [];
  let current = null;
  let inCode = false;

  const finalizeCurrent = () => {
    if (!current) return;
    const q = {
      id: crypto.randomUUID(),
      question: current.question?.trim() || '',
      question_type: current.question_type,
      options: current.question_type === 'multiple_choice' ? [
        current.options?.A || '',
        current.options?.B || '',
        current.options?.C || '',
        current.options?.D || '',
      ] : current.question_type === 'true_false' ? ['True', 'False'] : [],
      correct_answer: (current.correct_answer || '').trim(),
      points: Number.isFinite(current.points) && current.points > 0 ? current.points : 1,
      code_snippet: current.code_snippet?.trim() || '',
      isImported: true,
    };

    if (!q.question) {
      warnings.push({ code: 'missing_question', questionId: q.id, message: 'Missing question text.' });
    }
    if (!q.correct_answer) {
      warnings.push({ code: 'missing_answer', questionId: q.id, message: 'Missing correct answer.' });
    }
    if (q.question_type === 'multiple_choice') {
      if (q.options.some((opt) => !opt.trim())) {
        warnings.push({ code: 'invalid_options', questionId: q.id, message: 'Multiple choice must have A-D options.' });
      }
      const answer = q.correct_answer.toUpperCase();
      if (q.correct_answer && !['A', 'B', 'C', 'D'].includes(answer)) {
        warnings.push({ code: 'invalid_options', questionId: q.id, message: 'Multiple choice answer must be A, B, C, or D.' });
      }
      q.correct_answer = answer;
    }
    if (q.question_type === 'true_false' && q.correct_answer) {
      const normalized = q.correct_answer.toLowerCase();
      q.correct_answer = normalized === 'true' ? 'True' : normalized === 'false' ? 'False' : q.correct_answer;
      if (!['True', 'False'].includes(q.correct_answer)) {
        warnings.push({ code: 'invalid_options', questionId: q.id, message: 'True/False answer must be exactly True or False.' });
      }
    }

    questions.push(q);
    current = null;
    inCode = false;
  };

  const typeFromHeader = (line) => {
    const lower = line.toLowerCase();
    if (lower === '[multiple choice]') return 'multiple_choice';
    if (lower === '[true or false]') return 'true_false';
    if (lower === '[identification]') return 'identification';
    if (lower === '[trace the error]') return 'trace_error';
    return null;
  };

  for (const line of lines) {
    const foundType = typeFromHeader(line);
    if (foundType) {
      finalizeCurrent();
      current = {
        question_type: foundType,
        question: '',
        options: {},
        correct_answer: '',
        code_snippet: '',
        points: 1,
      };
      continue;
    }

    if (!current) continue;

    if (inCode) {
      if (/^(answer:|points:)/i.test(line)) {
        inCode = false;
      } else {
        current.code_snippet = current.code_snippet ? `${current.code_snippet}\n${line}` : line;
        continue;
      }
    }

    if (/^question:/i.test(line)) {
      current.question = line.replace(/^question:\s*/i, '').trim();
      continue;
    }

    const optionMatch = line.match(/^([ABCD])[\).:\-]\s*(.+)$/i);
    if (optionMatch) {
      current.options[optionMatch[1].toUpperCase()] = optionMatch[2].trim();
      continue;
    }

    if (/^answer:/i.test(line)) {
      current.correct_answer = line.replace(/^answer:\s*/i, '').trim();
      continue;
    }

    if (/^points:/i.test(line)) {
      const parsed = parseInt(line.replace(/^points:\s*/i, '').trim(), 10);
      current.points = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
      continue;
    }

    if (/^code:/i.test(line)) {
      const inlineCode = line.replace(/^code:\s*/i, '').trim();
      current.code_snippet = inlineCode;
      inCode = true;
      continue;
    }
  }

  finalizeCurrent();

  if (!questions.length) {
    warnings.push({ code: 'no_questions', questionId: null, message: 'No question blocks found. Use [Multiple Choice], [True or False], [Identification], or [Trace the Error].' });
  }

  return { questions, warnings };
}

function buildImportQuestionWarnings(questionList, importedIds) {
  const tracked = new Set(importedIds);
  const warnings = [];

  questionList.forEach((q) => {
    if (!tracked.has(q.id)) return;
    if (!q.question?.trim()) {
      warnings.push({ code: 'missing_question', questionId: q.id, message: 'Missing question text.' });
    }
    if (!q.correct_answer?.toString().trim()) {
      warnings.push({ code: 'missing_answer', questionId: q.id, message: 'Missing correct answer.' });
    }
    if (q.question_type === 'multiple_choice') {
      const options = Array.isArray(q.options) ? q.options : [];
      if (options.length < 4 || options.some((opt) => !`${opt || ''}`.trim())) {
        warnings.push({ code: 'invalid_options', questionId: q.id, message: 'Multiple choice must have non-empty A-D options.' });
      }
      const answer = `${q.correct_answer || ''}`.trim().toUpperCase();
      if (answer && !['A', 'B', 'C', 'D'].includes(answer)) {
        warnings.push({ code: 'invalid_options', questionId: q.id, message: 'Multiple choice answer must be A, B, C, or D.' });
      }
    }
    if (q.question_type === 'true_false') {
      const answer = `${q.correct_answer || ''}`.trim();
      if (answer && !['True', 'False'].includes(answer)) {
        warnings.push({ code: 'invalid_options', questionId: q.id, message: 'True/False answer must be True or False.' });
      }
    }
  });

  return warnings;
}

async function downloadDocxTemplate() {
  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({ children: [new TextRun({ text: 'Quiz Import Template', bold: true, size: 32 })] }),
        new Paragraph(''),
        new Paragraph('Use this exact format for reliable import.'),
        new Paragraph(''),
        new Paragraph('[Multiple Choice]'),
        new Paragraph('Question: What is 2 + 2?'),
        new Paragraph('A. 1'),
        new Paragraph('B. 2'),
        new Paragraph('C. 3'),
        new Paragraph('D. 4'),
        new Paragraph('Answer: D'),
        new Paragraph('Points: 1'),
        new Paragraph(''),
        new Paragraph('[True or False]'),
        new Paragraph('Question: Earth is a planet.'),
        new Paragraph('Answer: True'),
        new Paragraph('Points: 1'),
        new Paragraph(''),
        new Paragraph('[Identification]'),
        new Paragraph('Question: Capital of France'),
        new Paragraph('Answer: Paris'),
        new Paragraph('Points: 1'),
        new Paragraph(''),
        new Paragraph('[Trace the Error]'),
        new Paragraph('Question: What is wrong in this code?'),
        new Paragraph('Code:'),
        new Paragraph('print("Hello"'),
        new Paragraph('Answer: Missing closing parenthesis'),
        new Paragraph('Points: 1'),
      ],
    }],
  });

  const blob = await Packer.toBlob(doc);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'quiz_import_template.docx';
  link.click();
  URL.revokeObjectURL(link.href);
}

export default function QuizEditor({ classId, quiz, onDone, onCancel }) {
  const { user } = useAuthStore();
  const fileInputRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [title, setTitle] = useState(quiz?.title || '');
  const [description, setDescription] = useState(quiz?.description || '');
  const [timeLimit, setTimeLimit] = useState(quiz?.time_limit || '');
  const [dueDate, setDueDate] = useState(
    quiz?.due_date ? new Date(quiz.due_date).toISOString().slice(0, 16) : ''
  );
  const [questions, setQuestions] = useState(
    quiz?.quiz_questions?.length
      ? [...quiz.quiz_questions]
          .sort((a, b) => a.order_index - b.order_index)
          .map(q => {
            const type = q.question_type || 'multiple_choice';
            const existingOptions = Array.isArray(q.options) ? q.options : [];
            const normalizedOptions =
              type === 'multiple_choice'
                ? [existingOptions[0] || '', existingOptions[1] || '', existingOptions[2] || '', existingOptions[3] || '']
                : type === 'true_false'
                ? ['True', 'False']
                : [];

            return {
              id: q.id,
              question: q.question,
              question_type: type,
              options: normalizedOptions,
              correct_answer: q.correct_answer || '',
              points: q.points || 1,
              code_snippet: q.code_snippet || '',
            };
          })
      : []
  );
  const [importPreview, setImportPreview] = useState([]);
  const [importGlobalWarnings, setImportGlobalWarnings] = useState([]);
  const [importedQuestionIds, setImportedQuestionIds] = useState([]);
  const [formError, setFormError] = useState('');

  const importQuestionWarnings = buildImportQuestionWarnings(questions, importedQuestionIds);
  const importWarnings = [...importGlobalWarnings, ...importQuestionWarnings];
  const strictBlockingWarnings = importWarnings.filter((w) => STRICT_IMPORT_CODES.has(w.code));

  async function handleDocxImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.docx')) {
      alert('Please select a .docx file.');
      return;
    }

    try {
      setImporting(true);
      const arrayBuffer = await file.arrayBuffer();
      const { value } = await mammoth.extractRawText({ arrayBuffer });
      const { questions: parsedQuestions, warnings } = parseDocxQuestions(value || '');
      setImportPreview(parsedQuestions);
      const globalWarnings = warnings.filter((w) => !w.questionId);
      setImportGlobalWarnings((prev) => [...prev, ...globalWarnings]);
      if (!parsedQuestions.length) {
        alert('No importable questions found in this DOCX. Use the template format.');
      }
    } catch (error) {
      console.error(error);
      alert('Failed to parse DOCX file. Please verify the file format.');
    } finally {
      setImporting(false);
      event.target.value = '';
    }
  }

  function applyImportPreview() {
    if (!importPreview.length) return;
    const merged = [...questions, ...importPreview];
    setQuestions(merged);
    setImportedQuestionIds((prev) => [...prev, ...importPreview.map((q) => q.id)]);
    setImportPreview([]);
  }

  function addQuestion(type = 'multiple_choice') {
    const base = {
      id: crypto.randomUUID(),
      question: '',
      question_type: type,
      correct_answer: '',
      points: 1,
      code_snippet: '',
      isNew: true,
    };
    if (type === 'multiple_choice') base.options = ['', '', '', ''];
    if (type === 'true_false') base.options = ['True', 'False'];
    if (type === 'identification') base.options = [];
    if (type === 'trace_error') base.options = [];

    setQuestions(prev => [...prev, base]);
    setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 100);
  }

  function updateQ(idx, field, value) {
    setQuestions(prev => prev.map((q, i) => i === idx ? { ...q, [field]: value } : q));
  }

  function updateOption(qIdx, oIdx, value) {
    setQuestions(prev => prev.map((q, i) => {
      if (i !== qIdx) return q;
      const opts = [...q.options];
      opts[oIdx] = value;
      return { ...q, options: opts };
    }));
  }

  function removeQ(idx) {
    setQuestions(prev => {
      const removed = prev[idx];
      if (removed) {
        setImportedQuestionIds((ids) => ids.filter((id) => id !== removed.id));
      }
      return prev.filter((_, i) => i !== idx);
    });
  }

  function moveQ(idx, dir) {
    setQuestions(prev => {
      const arr = [...prev];
      const t = idx + dir;
      if (t < 0 || t >= arr.length) return arr;
      [arr[idx], arr[t]] = [arr[t], arr[idx]];
      return arr;
    });
  }

  async function handleSave() {
    setFormError('');

    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setFormError('Quiz title is required.');
      return;
    }
    if (normalizedTitle.length < 3) {
      setFormError('Quiz title must be at least 3 characters.');
      return;
    }
    if (normalizedTitle.length > 120) {
      setFormError('Quiz title must be 120 characters or less.');
      return;
    }

    if (description.trim().length > 1000) {
      setFormError('Description must be 1000 characters or less.');
      return;
    }

    const parsedTimeLimit = timeLimit ? parseInt(timeLimit, 10) : null;
    if (timeLimit && (!Number.isFinite(parsedTimeLimit) || parsedTimeLimit < 1 || parsedTimeLimit > 180)) {
      setFormError('Time limit must be between 1 and 180 minutes.');
      return;
    }

    if (dueDate) {
      const dueAt = new Date(dueDate).getTime();
      if (Number.isNaN(dueAt)) {
        setFormError('Due date is invalid.');
        return;
      }
      const originalDue = quiz?.due_date ? new Date(quiz.due_date).toISOString().slice(0, 16) : '';
      const dueChanged = dueDate !== originalDue;
      if (dueAt <= Date.now() && (!quiz || dueChanged)) {
        setFormError('Due date must be in the future.');
        return;
      }
    }

    if (questions.length === 0) {
      setFormError('Add at least one question.');
      return;
    }
    if (strictBlockingWarnings.length) {
      setFormError('Import warnings must be resolved before publishing: missing answers or invalid options are still present.');
      return;
    }

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.question.trim()) {
        setFormError(`Question ${i + 1} text is empty.`);
        return;
      }
      if (q.question.trim().length > 500) {
        setFormError(`Question ${i + 1} must be 500 characters or less.`);
        return;
      }
      if (!q.correct_answer) {
        setFormError(`Set a correct answer for question ${i + 1}.`);
        return;
      }
      if (q.question_type === 'multiple_choice') {
        if (q.options.some(o => !o.trim())) {
          setFormError(`Fill all options for question ${i + 1}.`);
          return;
        }
      }
      const points = parseInt(q.points, 10);
      if (!Number.isFinite(points) || points < 1 || points > 100) {
        setFormError(`Question ${i + 1} points must be between 1 and 100.`);
        return;
      }
    }

    setSaving(true);
    let quizId = quiz?.id;

    if (quiz) {
      await supabase.from('quizzes').update({
        title: normalizedTitle,
        description,
        time_limit: parsedTimeLimit,
        due_date: dueDate || null,
      }).eq('id', quiz.id);
    } else {
      const { data } = await supabase.from('quizzes').insert({
        class_id: classId,
        teacher_id: user.id,
        title: normalizedTitle,
        description,
        time_limit: parsedTimeLimit,
        due_date: dueDate || null,
        status: 'waiting',
      }).select().single();
      quizId = data.id;
    }

    const questionPayload = questions.map((q, i) => ({
      id: q.id,
      quiz_id: quizId,
      question: q.question,
      question_type: q.question_type,
      options: q.options,
      correct_answer: q.correct_answer,
      points: parseInt(q.points) || 1,
      order_index: i,
      code_snippet: q.code_snippet || null,
    }));

    if (quiz) {
      const existingIds = (quiz.quiz_questions || []).map(q => q.id);
      const nextIds = questionPayload.map(q => q.id);
      const removedIds = existingIds.filter(id => !nextIds.includes(id));
      if (removedIds.length) {
        await supabase.from('quiz_questions').delete().in('id', removedIds);
      }
      await supabase.from('quiz_questions').upsert(questionPayload, { onConflict: 'id' });
    } else {
      await supabase.from('quiz_questions').insert(questionPayload);
    }

    // Recalculate scores if editing finished quiz
    if (quiz) await recalcScores(quizId);

    setSaving(false);
    onDone();
  }

  async function recalcScores(quizId) {
    const { data: questions } = await supabase.from('quiz_questions').select('*').eq('quiz_id', quizId);
    const { data: submissions } = await supabase.from('quiz_submissions').select('*').eq('quiz_id', quizId);
    if (!submissions?.length) return;

    const totalPoints = questions.reduce((s, q) => s + (q.points || 1), 0);

    for (const sub of submissions) {
      let score = 0;
      questions.forEach(q => {
        const ans = sub.answers?.[q.id];
        if (!ans) return;
        if (q.question_type === 'trace_error') {
          if (ans === q.correct_answer) score += (q.points || 1);
        } else if (q.question_type === 'identification') {
          if (ans.trim().toUpperCase() === q.correct_answer.trim().toUpperCase()) score += (q.points || 1);
        } else {
          if (ans.trim().toUpperCase() === q.correct_answer.trim().toUpperCase()) score += (q.points || 1);
        }
      });
      await supabase.from('quiz_submissions').update({ score, total_points: totalPoints }).eq('id', sub.id);
    }
  }

  const totalPoints = questions.reduce((s, q) => s + (parseInt(q.points) || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{quiz ? 'Edit Quiz' : 'Create Quiz'}</h2>
          <p className="text-sm text-gray-500 mt-0.5">{questions.length} questions · {totalPoints} pts total</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={downloadDocxTemplate}
            className="flex items-center gap-2 px-4 py-2 text-gray-700 border border-gray-200 rounded-xl hover:bg-gray-50 transition-all"
          >
            <FileDown size={16} /> Template DOCX
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-2 px-4 py-2 text-gray-700 border border-gray-200 rounded-xl hover:bg-gray-50 transition-all disabled:opacity-60"
          >
            <Upload size={16} /> {importing ? 'Importing...' : 'Import DOCX'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx"
            className="hidden"
            onChange={handleDocxImport}
          />
          <button onClick={onCancel} className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium rounded-xl hover:bg-gray-100 transition-all">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-xl font-medium hover:bg-primary-dark transition-all shadow-md disabled:opacity-60">
            {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Check size={16} />}
            {saving ? 'Saving...' : 'Save Quiz'}
          </button>
        </div>
      </div>

      {formError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {formError}
        </div>
      )}

      {importWarnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
          <h3 className="font-semibold text-amber-900 flex items-center gap-2 mb-2">
            <AlertTriangle size={16} /> Import Warnings ({importWarnings.length})
          </h3>
          <p className="text-sm text-amber-800 mb-2">Resolve these before publishing. Missing answers and invalid options block Save Quiz.</p>
          <ul className="space-y-1.5">
            {importWarnings.map((w, idx) => (
              <li key={`${w.code}-${w.questionId || 'global'}-${idx}`} className="text-sm text-amber-900">
                {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {importPreview.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-gray-900">Import Preview</h3>
              <p className="text-sm text-gray-500">{importPreview.length} parsed question(s) ready to add to the editor.</p>
            </div>
            <button
              onClick={applyImportPreview}
              className="px-4 py-2 bg-primary text-white rounded-xl hover:bg-primary-dark transition-all"
            >
              Add Parsed Questions
            </button>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {importPreview.map((q, i) => (
              <div key={q.id} className="p-3 rounded-xl bg-gray-50 border border-gray-100">
                <p className="text-xs text-gray-500 mb-1">Q{i + 1} · {q.question_type.replace('_', ' ')}</p>
                <p className="text-sm font-medium text-gray-800 line-clamp-2">{q.question || '(Missing question text)'}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Details */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
        <h3 className="font-semibold text-gray-800">Quiz Details</h3>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Title <span className="text-red-500">*</span></label>
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Midterm Quiz — Chapter 3" className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} placeholder="Instructions for students..." rows={3} className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all resize-none" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5"><Clock size={13} className="inline mr-1" />Time Limit (minutes)</label>
            <input type="number" value={timeLimit} onChange={e => setTimeLimit(e.target.value)} placeholder="Leave blank for no limit" min={1} max={180} className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5"><Calendar size={13} className="inline mr-1" />Due Date</label>
            <input type="datetime-local" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all" />
          </div>
        </div>
      </div>

      {/* Questions */}
      <div className="space-y-4">
        {questions.map((q, idx) => (
          <QuestionCard
            key={q.id}
            q={q} idx={idx}
            total={questions.length}
            warnings={importWarnings.filter((w) => w.questionId === q.id)}
            onUpdate={(field, val) => updateQ(idx, field, val)}
            onUpdateOption={(oIdx, val) => updateOption(idx, oIdx, val)}
            onRemove={() => removeQ(idx)}
            onMove={(dir) => moveQ(idx, dir)}
          />
        ))}

        {/* Add Question */}
        <div className="bg-white rounded-2xl border-2 border-dashed border-blue-200 p-6">
          <p className="text-sm font-semibold text-gray-600 mb-3 text-center">Add Question</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {QUESTION_TYPES.map(type => (
              <button
                key={type.value}
                onClick={() => addQuestion(type.value)}
                className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-gray-100 hover:border-primary hover:bg-blue-50 transition-all group"
              >
                <type.icon size={22} className="text-gray-400 group-hover:text-primary transition-colors" />
                <span className="text-xs font-medium text-gray-600 group-hover:text-primary text-center">{type.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {questions.length > 0 && (
        <div className="flex justify-end pb-6">
          <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 bg-primary text-white px-6 py-3 rounded-xl font-medium hover:bg-primary-dark transition-all shadow-md disabled:opacity-60">
            {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Check size={16} />}
            {saving ? 'Saving...' : 'Save Quiz'}
          </button>
        </div>
      )}
    </div>
  );
}

function QuestionCard({ q, idx, total, warnings = [], onUpdate, onUpdateOption, onRemove, onMove }) {
  const typeInfo = QUESTION_TYPES.find(t => t.value === q.question_type);
  const blockingCount = warnings.filter((w) => STRICT_IMPORT_CODES.has(w.code)).length;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Card Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-gray-50 border-b border-gray-100">
        <div className="flex items-center gap-2">
          {typeInfo && <typeInfo.icon size={15} className="text-primary" />}
          <span className="font-semibold text-gray-700 text-sm">Question {idx + 1}</span>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{typeInfo?.label}</span>
          {warnings.length > 0 && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${blockingCount > 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
              {blockingCount > 0 ? `${blockingCount} blocking` : `${warnings.length} warning${warnings.length !== 1 ? 's' : ''}`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => onMove(-1)} disabled={idx === 0} className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-all"><ChevronUp size={16} /></button>
          <button onClick={() => onMove(1)} disabled={idx === total - 1} className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-all"><ChevronDown size={16} /></button>
          <button onClick={onRemove} className="p-1.5 rounded-lg hover:bg-red-100 text-gray-400 hover:text-red-600 transition-all ml-1"><Trash2 size={16} /></button>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {warnings.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-xs font-semibold text-amber-900 mb-1">Import issues for this question:</p>
            <ul className="space-y-1">
              {warnings.map((warning, i) => (
                <li key={`${warning.code}-${i}`} className="text-xs text-amber-900">
                  {warning.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Code Snippet (Trace the Error) */}
        {q.question_type === 'trace_error' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              <Code2 size={13} className="inline mr-1" />
              Code Snippet / Sample (optional)
            </label>
            <textarea
              value={q.code_snippet}
              onChange={e => onUpdate('code_snippet', e.target.value)}
              placeholder={"e.g.\nint x = 5;\nConsole.WrteLine(x);"}
              rows={5}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all resize-none bg-gray-50"
            />
          </div>
        )}

        {/* Question Text */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            {q.question_type === 'trace_error' ? 'Question / Instruction' : 'Question'}
          </label>
          <textarea
            value={q.question}
            onChange={e => onUpdate('question', e.target.value)}
            placeholder={
              q.question_type === 'trace_error'
                ? 'e.g. What is the error in the code above? or What is the correct output?'
                : q.question_type === 'identification'
                ? 'e.g. What is the capital of Pampanga?'
                : 'Enter your question here...'
            }
            rows={2}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all resize-none"
          />
        </div>

        {/* Multiple Choice Options */}
        {q.question_type === 'multiple_choice' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Options — <span className="text-primary font-semibold">click circle to mark correct</span>
            </label>
            <div className="space-y-3">
              {['A', 'B', 'C', 'D'].map((letter, oIdx) => (
                <div key={letter} className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${q.correct_answer === letter ? 'border-primary bg-blue-50' : 'border-gray-100 hover:border-gray-200'}`}>
                  <button
                    onClick={() => onUpdate('correct_answer', letter)}
                    className={`w-7 h-7 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all font-bold text-xs ${q.correct_answer === letter ? 'border-primary bg-primary text-white' : 'border-gray-300 text-gray-400 hover:border-primary'}`}
                  >
                    {q.correct_answer === letter ? <Check size={12} /> : letter}
                  </button>
                  <span className="text-sm font-medium text-gray-500 w-4">{letter}.</span>
                  <input
                    value={q.options[oIdx]}
                    onChange={e => onUpdateOption(oIdx, e.target.value)}
                    placeholder={`Option ${letter}`}
                    className="flex-1 bg-transparent text-sm focus:outline-none text-gray-800 placeholder-gray-400"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* True or False */}
        {q.question_type === 'true_false' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">Correct Answer</label>
            <div className="flex gap-3">
              {['True', 'False'].map(val => (
                <button
                  key={val}
                  onClick={() => onUpdate('correct_answer', val)}
                  className={`flex-1 py-3 rounded-xl border-2 font-semibold text-sm transition-all ${q.correct_answer === val ? 'border-primary bg-blue-50 text-primary' : 'border-gray-100 text-gray-500 hover:border-gray-300'}`}
                >
                  {val}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Identification */}
        {q.question_type === 'identification' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Correct Answer
              <span className="ml-2 text-xs text-gray-400 font-normal">(auto-caps + trim on grading)</span>
            </label>
            <input
              value={q.correct_answer}
              onChange={e => onUpdate('correct_answer', e.target.value)}
              placeholder="Type the correct answer..."
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
            />
          </div>
        )}

        {/* Trace the Error */}
        {q.question_type === 'trace_error' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Correct Answer
              <span className="ml-2 text-xs text-red-500 font-normal">⚠ Exact match — case-sensitive, no trimming</span>
            </label>
            <input
              value={q.correct_answer}
              onChange={e => onUpdate('correct_answer', e.target.value)}
              placeholder="Exact answer as student must type it..."
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
            />
            <p className="text-xs text-gray-400 mt-1.5">Student must type exactly: spaces, capitalization, punctuation — all matter.</p>
          </div>
        )}

        {/* Points */}
        <div className="flex items-center gap-3 pt-1">
          <label className="text-sm font-medium text-gray-700">Points:</label>
          <input
            type="number"
            value={q.points}
            onChange={e => onUpdate('points', e.target.value)}
            min={1}
            className="w-20 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all text-center"
          />
        </div>
      </div>
    </div>
  );
}