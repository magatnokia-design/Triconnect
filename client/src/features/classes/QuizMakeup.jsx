import { useState, useEffect } from 'react';
import { supabase } from '../../config/supabase';
import { useAuthStore } from '../../store/authStore';
import { ArrowLeft, UserPlus, Check, X, Clock, AlertCircle } from 'lucide-react';

export default function QuizMakeup({ quiz, classId, onBack }) {
  const { user } = useAuthStore();
  const [students, setStudents] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(null);

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true);
    const [{ data: enrolled }, { data: assigned }, { data: submitted }] = await Promise.all([
      supabase.from('class_enrollments').select('student_id, profiles(full_name, student_id)').eq('class_id', classId),
      supabase.from('quiz_makeup_assignments').select('*').eq('quiz_id', quiz.id),
      supabase.from('quiz_submissions').select('student_id').eq('quiz_id', quiz.id),
    ]);

    const submittedIds = new Set((submitted || []).map(s => s.student_id));
    const assignedIds = new Set((assigned || []).map(a => a.student_id));

    // Show only students who haven't submitted
    const list = (enrolled || [])
      .filter(e => !submittedIds.has(e.student_id))
      .map(e => ({
        ...e.profiles,
        studentId: e.student_id,
        assigned: assignedIds.has(e.student_id),
      }));

    setStudents(list);
    setAssignments(assigned || []);
    setLoading(false);
  }

  async function toggleAssign(studentId, isAssigned) {
    setAssigning(studentId);
    if (isAssigned) {
      await supabase.from('quiz_makeup_assignments').delete().match({ quiz_id: quiz.id, student_id: studentId });
    } else {
      await supabase.from('quiz_makeup_assignments').insert({ quiz_id: quiz.id, student_id: studentId, assigned_by: user.id });
    }
    await fetchData();
    setAssigning(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-all"><ArrowLeft size={20} /></button>
        <div>
          <h2 className="text-xl font-bold text-gray-900">Makeup Quiz</h2>
          <p className="text-sm text-gray-500">{quiz.title} — assign to absent/excused students</p>
        </div>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 flex items-start gap-2">
        <AlertCircle size={16} className="text-yellow-600 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-yellow-700">Only students who haven't submitted are shown. Assigned students can take the quiz independently at their own pace.</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : students.length === 0 ? (
        <div className="text-center py-16 bg-surface rounded-2xl border-2 border-dashed border-blue-200">
          <Check size={40} className="mx-auto text-green-400 mb-3" />
          <p className="text-gray-500 font-medium">All students have submitted!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {students.map(s => (
            <div key={s.studentId} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-white font-bold">
                  {s.full_name?.[0]?.toUpperCase() || '?'}
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{s.full_name}</p>
                  {s.student_id && <p className="text-xs text-gray-400">{s.student_id}</p>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {s.assigned && (
                  <span className="flex items-center gap-1 text-xs text-purple-600 bg-purple-50 px-2.5 py-1 rounded-full font-medium">
                    <Clock size={11} /> Assigned
                  </span>
                )}
                <button
                  onClick={() => toggleAssign(s.studentId, s.assigned)}
                  disabled={assigning === s.studentId}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                    s.assigned
                      ? 'bg-red-50 text-red-600 hover:bg-red-100'
                      : 'bg-primary text-white hover:bg-primary-dark'
                  }`}
                >
                  {assigning === s.studentId ? (
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  ) : s.assigned ? (
                    <><X size={14} /> Unassign</>
                  ) : (
                    <><UserPlus size={14} /> Assign</>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}