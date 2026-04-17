const { supabase } = require('../shared/config/supabase');
const QUIZ_TEACHER_RECONNECT_GRACE_MS = Number(process.env.QUIZ_TEACHER_RECONNECT_GRACE_MS || 45000);

// roomId => { students: Map<socketId, {studentId, name, connected}>, teacherSocket }
const rooms = new Map();
const roomTimers = new Map();
const teacherReconnectTimers = new Map();

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getRoomByCode(code) {
  for (const [roomId, room] of rooms.entries()) {
    if (room.code === code) return { roomId, room };
  }
  return null;
}

function broadcastRoom(io, roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const studentList = Array.from(room.students.values());
  io.to(roomId).emit('room-update', { students: studentList });
}

module.exports = function setupQuizSocket(io) {
  const emitQuizError = (socket, message) => {
    socket.emit('quiz-error', { message });
  };

  const clearTeacherReconnectTimer = (quizId) => {
    const active = teacherReconnectTimers.get(quizId);
    if (active) {
      clearTimeout(active);
      teacherReconnectTimers.delete(quizId);
    }

    const room = rooms.get(quizId);
    if (room) {
      room.teacherReconnectUntil = null;
    }
  };

  const isTeacherHost = (room, socket, teacherId = null) => {
    if (!room) return false;
    if (room.teacherSocketId && room.teacherSocketId === socket.id) return true;
    if (teacherId && room.teacherId === teacherId) return true;
    return false;
  };

  const scheduleTeacherReconnectGrace = (quizId) => {
    clearTeacherReconnectTimer(quizId);
    const room = rooms.get(quizId);
    if (!room) return;

    room.teacherReconnectUntil = Date.now() + QUIZ_TEACHER_RECONNECT_GRACE_MS;
    io.to(quizId).emit('teacher-reconnecting', {
      reconnectUntil: room.teacherReconnectUntil,
      graceMs: QUIZ_TEACHER_RECONNECT_GRACE_MS,
    });

    const timer = setTimeout(async () => {
      const activeRoom = rooms.get(quizId);
      if (!activeRoom) return;
      if (activeRoom.teacherSocketId) return;

      activeRoom.status = 'ended';
      activeRoom.questionEndsAt = null;
      clearRoomTimer(quizId);
      io.to(quizId).emit('teacher-reconnect-timeout', {
        message: 'Teacher disconnected for too long. Quiz session was ended to protect results consistency.',
      });
      await finalizeQuiz(quizId);
    }, QUIZ_TEACHER_RECONNECT_GRACE_MS);

    teacherReconnectTimers.set(quizId, timer);
  };

  const clearRoomTimer = (quizId) => {
    const active = roomTimers.get(quizId);
    if (active) {
      clearTimeout(active);
      roomTimers.delete(quizId);
    }
  };

  const emitCurrentQuestion = (quizId, eventName = 'question-start') => {
    const room = rooms.get(quizId);
    if (!room) return;
    const question = room.questions[room.currentIndex];
    io.to(quizId).emit(eventName, {
      question: sanitizeQuestion(question),
      index: room.currentIndex,
      total: room.questions.length,
      questionEndsAt: room.questionEndsAt,
      questionTimeLimitSec: room.questionTimeLimitSec,
    });
  };

  const finalizeQuiz = async (quizId) => {
    const room = rooms.get(quizId);
    if (!room) return;
    clearRoomTimer(quizId);
    clearTeacherReconnectTimer(quizId);
    room.status = 'ended';
    room.questionEndsAt = null;

    await supabase.from('quizzes').update({ status: 'ended' }).eq('id', quizId);
    await saveAllSubmissions(room, quizId);
    io.to(quizId).emit('quiz-ended');
  };

  const scheduleAutoAdvance = (quizId) => {
    clearRoomTimer(quizId);
    const room = rooms.get(quizId);
    if (!room || room.status !== 'active' || !room.questionTimeLimitSec || !room.questionEndsAt) return;

    const waitMs = Math.max(room.questionEndsAt - Date.now(), 0);
    const timer = setTimeout(async () => {
      const activeRoom = rooms.get(quizId);
      if (!activeRoom || activeRoom.status !== 'active') return;

      activeRoom.currentIndex += 1;

      if (activeRoom.currentIndex >= activeRoom.questions.length) {
        await finalizeQuiz(quizId);
        return;
      }

      activeRoom.questionEndsAt = activeRoom.questionTimeLimitSec
        ? Date.now() + (activeRoom.questionTimeLimitSec * 1000)
        : null;

      await supabase.from('quizzes').update({
        current_question_index: activeRoom.currentIndex,
      }).eq('id', quizId);

      emitCurrentQuestion(quizId, 'question-start');
      scheduleAutoAdvance(quizId);
    }, waitMs);

    roomTimers.set(quizId, timer);
  };

  io.on('connection', (socket) => {

    // Teacher: initialize room
    socket.on('teacher-init-room', async ({ quizId, teacherId, questionTimeLimitSec, lateJoinPolicyCurrentOnly }) => {
      let room = rooms.get(quizId);
      if (!room) {
        const code = generateCode();
        room = {
          quizId,
          teacherId,
          code,
          teacherSocketId: socket.id,
          students: new Map(),
          currentIndex: 0,
          status: 'waiting',
          questions: [],
          questionTimeLimitSec: Number.isFinite(questionTimeLimitSec) && questionTimeLimitSec > 0 ? questionTimeLimitSec : 30,
          questionEndsAt: null,
          lateJoinPolicyCurrentOnly: lateJoinPolicyCurrentOnly !== false,
          teacherReconnectUntil: null,
        };
        rooms.set(quizId, room);

        await supabase.from('quizzes').update({
          join_code: code,
          status: 'waiting',
          current_question_index: 0,
          results_revealed: false,
        }).eq('id', quizId);
      } else {
        room.teacherSocketId = socket.id;
        room.teacherId = teacherId;
        clearTeacherReconnectTimer(quizId);
        if (Number.isFinite(questionTimeLimitSec) && questionTimeLimitSec > 0) {
          room.questionTimeLimitSec = questionTimeLimitSec;
        }
        if (typeof lateJoinPolicyCurrentOnly === 'boolean') {
          room.lateJoinPolicyCurrentOnly = lateJoinPolicyCurrentOnly;
        }
      }

      socket.join(quizId);
      socket.emit('room-ready', {
        code: room.code,
        students: Array.from(room.students.values()),
        questionTimeLimitSec: room.questionTimeLimitSec,
        lateJoinPolicyCurrentOnly: room.lateJoinPolicyCurrentOnly,
        teacherReconnectUntil: room.teacherReconnectUntil,
      });
    });

    socket.on('teacher-update-room-settings', ({ quizId, questionTimeLimitSec, lateJoinPolicyCurrentOnly }) => {
      const room = rooms.get(quizId);
      if (!room) return;
      if (!isTeacherHost(room, socket)) {
        emitQuizError(socket, 'Only the teacher host can update room settings.');
        return;
      }

      if (Number.isFinite(questionTimeLimitSec) && questionTimeLimitSec > 0) {
        room.questionTimeLimitSec = questionTimeLimitSec;
      }
      if (typeof lateJoinPolicyCurrentOnly === 'boolean') {
        room.lateJoinPolicyCurrentOnly = lateJoinPolicyCurrentOnly;
      }

      if (room.status === 'active') {
        room.questionEndsAt = room.questionTimeLimitSec
          ? Date.now() + (room.questionTimeLimitSec * 1000)
          : null;
        scheduleAutoAdvance(quizId);
        io.to(quizId).emit('question-timer-sync', {
          questionEndsAt: room.questionEndsAt,
          questionTimeLimitSec: room.questionTimeLimitSec,
        });
      }

      io.to(quizId).emit('room-settings-updated', {
        questionTimeLimitSec: room.questionTimeLimitSec,
        lateJoinPolicyCurrentOnly: room.lateJoinPolicyCurrentOnly,
      });
    });

    // Student: join room via code
    socket.on('student-join', async ({ code, studentId, studentName }) => {
      const found = getRoomByCode(code);
      if (!found) {
        socket.emit('join-error', { message: 'Invalid quiz code.' });
        return;
      }

      const { roomId, room } = found;

      if (room.status === 'ended') {
        socket.emit('join-error', { message: 'This quiz has already ended.' });
        return;
      }

      if (room.status === 'active' && !room.lateJoinPolicyCurrentOnly) {
        socket.emit('join-error', { message: 'Late joining is currently disabled by the teacher.' });
        return;
      }

      // Check if rejoin
      let existing = null;
      for (const [sid, s] of room.students.entries()) {
        if (s.studentId === studentId) { existing = { sid, s }; break; }
      }

      if (existing) {
        room.students.delete(existing.sid);
      }

      room.students.set(socket.id, {
        socketId: socket.id,
        studentId,
        name: studentName,
        connected: true,
        answers: existing?.s?.answers || {},
      });

      socket.join(roomId);

      // If quiz in progress, send current question
      if (room.status === 'active') {
        const q = room.questions[room.currentIndex];
        socket.emit('question-start', {
          question: sanitizeQuestion(q),
          index: room.currentIndex,
          total: room.questions.length,
          questionEndsAt: room.questionEndsAt,
          questionTimeLimitSec: room.questionTimeLimitSec,
        });
      } else {
        socket.emit('joined-waiting', { quizId: roomId, code });
      }

      // Notify teacher
      broadcastRoom(io, roomId);
      if (room.teacherSocketId) {
        io.to(room.teacherSocketId).emit('student-list-update', {
          students: Array.from(room.students.values()).map(s => ({
            studentId: s.studentId,
            name: s.name,
            connected: s.connected,
            answeredCount: Object.keys(s.answers || {}).length,
          }))
        });
      }
    });

    // Teacher: load questions and start quiz
    socket.on('start-quiz', async ({ quizId, questionTimeLimitSec, lateJoinPolicyCurrentOnly }) => {
      const room = rooms.get(quizId);
      if (!room) return;
      if (!isTeacherHost(room, socket)) {
        emitQuizError(socket, 'Only the teacher host can start the quiz.');
        return;
      }

      const { data: questions } = await supabase
        .from('quiz_questions')
        .select('*')
        .eq('quiz_id', quizId)
        .order('order_index');

      room.questions = questions || [];
      if (!room.questions.length) {
        emitQuizError(socket, 'Add at least one question before starting the quiz.');
        return;
      }
      room.currentIndex = 0;
      room.status = 'active';
      if (Number.isFinite(questionTimeLimitSec) && questionTimeLimitSec > 0) {
        room.questionTimeLimitSec = questionTimeLimitSec;
      }
      if (typeof lateJoinPolicyCurrentOnly === 'boolean') {
        room.lateJoinPolicyCurrentOnly = lateJoinPolicyCurrentOnly;
      }
      room.questionEndsAt = room.questionTimeLimitSec
        ? Date.now() + (room.questionTimeLimitSec * 1000)
        : null;

      await supabase.from('quizzes').update({
        status: 'active',
        current_question_index: 0,
      }).eq('id', quizId);

      emitCurrentQuestion(quizId, 'quiz-started');
      scheduleAutoAdvance(quizId);
    });

    // Teacher: next question
    socket.on('next-question', async ({ quizId }) => {
      const room = rooms.get(quizId);
      if (!room) return;
      if (!isTeacherHost(room, socket)) {
        emitQuizError(socket, 'Only the teacher host can move to the next question.');
        return;
      }
      if (room.status !== 'active') {
        emitQuizError(socket, 'Quiz is not active.');
        return;
      }

      clearRoomTimer(quizId);

      room.currentIndex += 1;

      if (room.currentIndex >= room.questions.length) {
        await finalizeQuiz(quizId);
        return;
      }

      room.questionEndsAt = room.questionTimeLimitSec
        ? Date.now() + (room.questionTimeLimitSec * 1000)
        : null;

      await supabase.from('quizzes').update({
        current_question_index: room.currentIndex,
      }).eq('id', quizId);

      emitCurrentQuestion(quizId, 'question-start');
      scheduleAutoAdvance(quizId);
    });

    // Student: submit answer
    socket.on('submit-answer', ({ quizId, questionId, answer }) => {
      const room = rooms.get(quizId);
      if (!room) return;
      const student = room.students.get(socket.id);
      if (!student) return;

      if (room.status !== 'active') {
        socket.emit('submit-rejected', { message: 'Quiz is not currently accepting answers.' });
        return;
      }

      const activeQuestion = room.questions[room.currentIndex];
      if (!activeQuestion || activeQuestion.id !== questionId) {
        socket.emit('submit-rejected', { message: 'This question is already closed.' });
        return;
      }

      if (room.questionEndsAt && Date.now() > room.questionEndsAt) {
        socket.emit('submit-rejected', { message: 'Time is up for this question.' });
        return;
      }

      if (answer === undefined || answer === null || `${answer}`.trim() === '') {
        socket.emit('submit-rejected', { message: 'Answer cannot be empty.' });
        return;
      }

      student.answers[questionId] = answer;
      socket.emit('submit-ack', {
        questionId,
        acceptedAt: Date.now(),
      });

      // Notify teacher of answer count update
      if (room.teacherSocketId) {
        io.to(room.teacherSocketId).emit('student-list-update', {
          students: Array.from(room.students.values()).map(s => ({
            studentId: s.studentId,
            name: s.name,
            connected: s.connected,
            answeredCount: Object.keys(s.answers || {}).length,
          }))
        });
      }
    });

    // Teacher: reveal results
    socket.on('reveal-results', async ({ quizId }) => {
      const room = rooms.get(quizId);
      if (!room) return;
      if (!isTeacherHost(room, socket)) {
        emitQuizError(socket, 'Only the teacher host can reveal results.');
        return;
      }

      await supabase.from('quizzes').update({ results_revealed: true }).eq('id', quizId);

      const results = await buildResults(room, quizId);
      io.to(quizId).emit('results-revealed', { results });
    });

    // Teacher: end quiz manually
    socket.on('end-quiz', async ({ quizId }) => {
      const room = rooms.get(quizId);
      if (!room) return;
      if (!isTeacherHost(room, socket)) {
        emitQuizError(socket, 'Only the teacher host can end the quiz.');
        return;
      }
      await finalizeQuiz(quizId);
    });

    // Disconnect
    socket.on('disconnect', () => {
      for (const [quizId, room] of rooms.entries()) {
        const student = room.students.get(socket.id);
        if (student) {
          student.connected = false;
          if (room.teacherSocketId) {
            io.to(room.teacherSocketId).emit('student-list-update', {
              students: Array.from(room.students.values()).map(s => ({
                studentId: s.studentId,
                name: s.name,
                connected: s.connected,
                answeredCount: Object.keys(s.answers || {}).length,
              }))
            });
          }
        }
        if (room.teacherSocketId === socket.id) {
          room.teacherSocketId = null;
          scheduleTeacherReconnectGrace(quizId);
        }
      }
    });
  });
};

// Strip correct_answer before sending to students
function sanitizeQuestion(q) {
  if (!q) return null;
  const { correct_answer, ...safe } = q;
  return safe;
}

function gradeAnswer(question, rawAnswer) {
  if (!rawAnswer) return false;
  const type = question.question_type;
  const correct = question.correct_answer;

  if (type === 'multiple_choice' || type === 'true_false') {
    return rawAnswer.trim().toUpperCase() === correct.trim().toUpperCase();
  }
  if (type === 'identification') {
    return rawAnswer.trim().toUpperCase() === correct.trim().toUpperCase();
  }
  if (type === 'trace_error') {
    // Exact match — no trim, no caps
    return rawAnswer === correct;
  }
  return false;
}

async function saveAllSubmissions(room, quizId) {
  const { data: questions } = await supabase
    .from('quiz_questions')
    .select('*')
    .eq('quiz_id', quizId);

  const totalPoints = questions.reduce((s, q) => s + (q.points || 1), 0);

  for (const student of room.students.values()) {
    let score = 0;
    questions.forEach(q => {
      if (gradeAnswer(q, student.answers[q.id])) {
        score += (q.points || 1);
      }
    });

    await supabase.from('quiz_submissions').upsert({
      quiz_id: quizId,
      student_id: student.studentId,
      answers: student.answers,
      score,
      total_points: totalPoints,
      submitted_at: new Date().toISOString(),
    }, { onConflict: 'quiz_id,student_id' });
  }
}

async function buildResults(room, quizId) {
  const { data: questions } = await supabase
    .from('quiz_questions')
    .select('*')
    .eq('quiz_id', quizId)
    .order('order_index');

  const totalPoints = (questions || []).reduce((sum, q) => sum + (q.points || 1), 0);

  const { data: submissions } = await supabase
    .from('quiz_submissions')
    .select('*, profiles(full_name, student_id)')
    .eq('quiz_id', quizId);

  if (!submissions?.length) return [];

  const recalculated = submissions
    .map((submission) => {
      const score = (questions || []).reduce((sum, q) => {
        if (!gradeAnswer(q, submission.answers?.[q.id])) return sum;
        return sum + (q.points || 1);
      }, 0);

      return {
        ...submission,
        score,
        total_points: totalPoints,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(a.submitted_at || 0).getTime() - new Date(b.submitted_at || 0).getTime();
    });

  for (const submission of recalculated) {
    await supabase
      .from('quiz_submissions')
      .update({ score: submission.score, total_points: submission.total_points })
      .eq('id', submission.id);
  }

  const studentIds = [...new Set(recalculated.map(s => s.student_id).filter(Boolean))];
  let profileMap = new Map();

  if (studentIds.length) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, student_id')
      .in('id', studentIds);

    profileMap = new Map((profiles || []).map(p => [p.id, p]));
  }

  return recalculated.map(submission => {
    const fallbackProfile = profileMap.get(submission.student_id);
    const roomStudent = Array.from(room.students.values()).find(s => s.studentId === submission.student_id);
    const mergedProfile = submission.profiles || fallbackProfile || null;

    return {
      ...submission,
      profiles: mergedProfile,
      student_name: mergedProfile?.full_name || roomStudent?.name || submission.student_id || 'Unknown',
    };
  });
}