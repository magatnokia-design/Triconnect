import { supabase } from '../../config/supabase'
import JSZip from 'jszip'
import { createClassNotification } from '../notifications/notificationService'

const generateCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

const normalizePathSegment = (value) =>
  String(value || 'file')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')

const buildStoragePath = ({ classId, folder, fileName }) => {
  const safeName = normalizePathSegment(fileName)
  return `${classId}/${folder}/${Date.now()}_${safeName}`
}

const extractStoragePath = (fileUrl, bucket) => {
  return fileUrl?.split(`/storage/v1/object/public/${bucket}/`)[1] || null
}

const isMissingColumnError = (error, columnName) => {
  if (!error) return false
  const message = String(error.message || '').toLowerCase()
  return message.includes(`column \"${columnName.toLowerCase()}\"`) || message.includes(`column '${columnName.toLowerCase()}'`)
}

const normalizeUploadSelection = async ({ file, folderFiles, zipBaseName }) => {
  if (file) return file

  const files = Array.from(folderFiles || []).filter(Boolean)
  if (files.length === 0) return null

  const zip = new JSZip()
  files.forEach((entry) => {
    const path = entry.webkitRelativePath || entry.name
    zip.file(path, entry)
  })

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })

  const safeBaseName = normalizePathSegment(zipBaseName || 'folder-upload')
  return new File([blob], `${safeBaseName}-${Date.now()}.zip`, { type: 'application/zip' })
}

const assignmentSortDate = (assignment) => assignment.publish_at || assignment.created_at || ''

const isStudentVisibleAssignment = (assignment) => {
  const status = assignment.status || 'published'
  if (status === 'draft') return false
  if (status !== 'scheduled') return true
  if (!assignment.publish_at) return false
  return new Date(assignment.publish_at) <= new Date()
}

export const createClass = async ({ name, subject, section, description, teacherId }) => {
  let code = generateCode()

  // ensure unique code
  let exists = true
  while (exists) {
    const { data } = await supabase.from('classes').select('id').eq('code', code).maybeSingle()
    if (!data) exists = false
    else code = generateCode()
  }

  const { data, error } = await supabase
    .from('classes')
    .insert({ name, subject, section, description, code, teacher_id: teacherId })
    .select()
    .single()

  return { data, error }
}

export const getTeacherClasses = async (teacherId) => {
  const { data, error } = await supabase
    .from('classes')
    .select('*, class_enrollments(count)')
    .eq('teacher_id', teacherId)
    .order('created_at', { ascending: false })

  if (!error) return { data, error: null }

  // Fallback when embedded relation metadata is missing/stale.
  const { data: classes, error: classesError } = await supabase
    .from('classes')
    .select('*')
    .eq('teacher_id', teacherId)
    .order('created_at', { ascending: false })

  if (classesError) return { data: null, error: classesError }

  const classIds = (classes || []).map((c) => c.id)
  let enrollmentRows = []

  if (classIds.length > 0) {
    const { data: rows } = await supabase
      .from('class_enrollments')
      .select('class_id')
      .in('class_id', classIds)
    enrollmentRows = rows || []
  }

  const countByClass = enrollmentRows.reduce((acc, row) => {
    acc[row.class_id] = (acc[row.class_id] || 0) + 1
    return acc
  }, {})

  const normalized = (classes || []).map((cls) => ({
    ...cls,
    class_enrollments: [{ count: countByClass[cls.id] || 0 }],
  }))

  return { data: normalized, error: null }
}

export const getStudentClasses = async (studentId) => {
  const { data, error } = await supabase
    .from('class_enrollments')
    .select('*, classes(*)')
    .eq('student_id', studentId)
    .order('enrolled_at', { ascending: false })

  if (!error) return { data, error: null }

  // Fallback when embedded relation metadata is missing/stale.
  const { data: enrollments, error: enrollmentError } = await supabase
    .from('class_enrollments')
    .select('*')
    .eq('student_id', studentId)
    .order('enrolled_at', { ascending: false })

  if (enrollmentError) return { data: null, error: enrollmentError }

  const classIds = (enrollments || []).map((e) => e.class_id)
  let classesById = {}

  if (classIds.length > 0) {
    const { data: classes } = await supabase
      .from('classes')
      .select('*')
      .in('id', classIds)

    classesById = Object.fromEntries((classes || []).map((c) => [c.id, c]))
  }

  const normalized = (enrollments || [])
    .map((e) => ({
      ...e,
      classes: classesById[e.class_id] || null,
    }))
    .filter((e) => Boolean(e.classes))

  return { data: normalized, error: null }
}

export const joinClass = async ({ code, studentId }) => {
  const { data: classData, error: findError } = await supabase
    .from('classes')
    .select('*')
    .eq('code', code.trim().toUpperCase())
    .maybeSingle()

  if (findError || !classData) return { error: { message: 'Class not found. Check the code and try again.' } }

  // check already enrolled
  const { data: existing } = await supabase
    .from('class_enrollments')
    .select('id')
    .eq('class_id', classData.id)
    .eq('student_id', studentId)
    .maybeSingle()

  if (existing) return { error: { message: 'You are already enrolled in this class.' } }

  const { data, error } = await supabase
    .from('class_enrollments')
    .insert({ class_id: classData.id, student_id: studentId })
    .select()
    .single()

  // Best-effort: initialize the teacher-student direct thread on enrollment.
  if (!error && classData?.teacher_id) {
    const { error: threadError } = await supabase
      .from('class_direct_threads')
      .insert({
        class_id: classData.id,
        teacher_id: classData.teacher_id,
        student_id: studentId,
      })

    // Ignore duplicate thread race if one already exists.
    if (threadError && threadError.code !== '23505') {
      // Non-blocking by design: enrollment should still succeed.
      console.warn('Direct thread initialization failed:', threadError.message)
    }
  }

  return { data, classData, error }
}

export const getClassById = async (classId, profile) => {
  const { data, error } = await supabase
    .from('classes')
    .select('*')
    .eq('id', classId)
    .maybeSingle()

  if (data) return { data, error: null }

  if (profile?.role === 'student' && profile?.id) {
    const { data: enrollment, error: enrollmentError } = await supabase
      .from('class_enrollments')
      .select('id')
      .eq('class_id', classId)
      .eq('student_id', profile.id)
      .maybeSingle()

    if (!enrollment) return { data: null, error: enrollmentError || error }

    const { data: classFromMembership, error: classFromMembershipError } = await supabase
      .from('classes')
      .select('*')
      .eq('id', classId)
      .maybeSingle()

    return {
      data: classFromMembership || null,
      error: classFromMembershipError || enrollmentError || error,
    }
  }

  return { data: null, error }
}

export const getClassStudents = async (classId) => {
  const { data, error } = await supabase
    .from('class_enrollments')
    .select('*, profiles(id, full_name, email, student_id)')
    .eq('class_id', classId)

  return { data, error }
}

export const deleteClass = async (classId) => {
  const { error } = await supabase.from('classes').delete().eq('id', classId)
  return { error }
}

export const unenrollStudent = async (classId, studentId) => {
  const { error } = await supabase
    .from('class_enrollments')
    .delete()
    .eq('class_id', classId)
    .eq('student_id', studentId)
  return { error }
}

// ─── MODULES ───────────────────────────────────────────

export const uploadModule = async ({ classId, teacherId, title, description, file, folderFiles }) => {
  const uploadFile = await normalizeUploadSelection({
    file,
    folderFiles,
    zipBaseName: title || 'module-folder',
  })

  if (!uploadFile) return { data: null, error: { message: 'Please choose a file or folder to upload.' } }

  const fileName = buildStoragePath({
    classId,
    folder: 'modules',
    fileName: uploadFile.name,
  })

  const { error: uploadError } = await supabase.storage
    .from('modules')
    .upload(fileName, uploadFile)

  if (uploadError) return { error: uploadError }

  const { data: { publicUrl } } = supabase.storage
    .from('modules')
    .getPublicUrl(fileName)

  const { data, error } = await supabase
    .from('modules')
    .insert({
      class_id: classId,
      teacher_id: teacherId,
      title,
      description,
      file_url: publicUrl,
      file_name: uploadFile.name,
      file_type: uploadFile.type,
      file_size: uploadFile.size,
    })
    .select()
    .single()

  if (!error && data) {
    const { error: notificationError } = await createClassNotification({
      classId,
      actorId: teacherId,
      type: 'module_created',
      title: 'New module available',
      body: title || data.file_name || 'A new module has been posted.',
      targetPath: `/classes/${classId}?tab=Modules`,
      targetParams: { moduleId: data.id },
      recipients: 'students',
    })

    if (notificationError) {
      console.warn('Module notification failed:', notificationError.message)
    }
  }

  return { data, error }
}

export const getModules = async (classId) => {
  const { data, error } = await supabase
    .from('modules')
    .select('*')
    .eq('class_id', classId)
    .order('created_at', { ascending: false })

  return { data, error }
}

export const deleteModule = async (moduleId, fileUrl) => {
  const path = extractStoragePath(fileUrl, 'modules')

  if (path) {
    await supabase.storage.from('modules').remove([path])
  }

  const { error } = await supabase.from('modules').delete().eq('id', moduleId)
  return { error }
}

// ─── ASSIGNMENTS ────────────────────────────────────────

export const createAssignment = async ({
  classId,
  teacherId,
  title,
  description,
  maxPoints,
  dueDate,
  file,
  folderFiles,
  publishMode = 'publish_now',
  publishAt = null,
}) => {
  let file_url = null
  let file_name = null

  const uploadFile = await normalizeUploadSelection({
    file,
    folderFiles,
    zipBaseName: title || 'assignment-folder',
  })

  if (uploadFile) {
    const fileName = buildStoragePath({
      classId,
      folder: 'assignments',
      fileName: uploadFile.name,
    })

    const { error: uploadError } = await supabase.storage
      .from('submissions')
      .upload(fileName, uploadFile)

    if (uploadError) return { error: uploadError }

    const { data: { publicUrl } } = supabase.storage
      .from('submissions')
      .getPublicUrl(fileName)

    file_url = publicUrl
    file_name = uploadFile.name
  }

  const normalizedPublishMode = ['draft', 'schedule', 'publish_now'].includes(publishMode)
    ? publishMode
    : 'publish_now'

  const assignmentPayload = {
    class_id: classId,
    teacher_id: teacherId,
    title,
    description,
    max_points: maxPoints,
    due_date: dueDate || null,
    file_url,
    file_name,
    status: normalizedPublishMode === 'draft'
      ? 'draft'
      : (normalizedPublishMode === 'schedule' ? 'scheduled' : 'published'),
    publish_at: normalizedPublishMode === 'schedule' ? publishAt : null,
  }

  let { data, error } = await supabase
    .from('assignments')
    .insert(assignmentPayload)
    .select()
    .single()

  if (error && (isMissingColumnError(error, 'status') || isMissingColumnError(error, 'publish_at'))) {
    const fallbackPayload = {
      class_id: classId,
      teacher_id: teacherId,
      title,
      description,
      max_points: maxPoints,
      due_date: dueDate || null,
      file_url,
      file_name,
    }

    const fallbackResult = await supabase
      .from('assignments')
      .insert(fallbackPayload)
      .select()
      .single()

    data = fallbackResult.data
    error = fallbackResult.error
  }

  const shouldNotifyStudents = Boolean(
    !error
    && data
    && (
      data.status
        ? data.status === 'published'
        : normalizedPublishMode === 'publish_now'
    )
  )

  if (shouldNotifyStudents) {
    const { error: notificationError } = await createClassNotification({
      classId,
      actorId: teacherId,
      type: 'assignment_published',
      title: 'New assignment published',
      body: title || data.title || 'A new assignment is available.',
      targetPath: `/classes/${classId}?tab=Assignments`,
      targetParams: { assignmentId: data.id },
      recipients: 'students',
    })

    if (notificationError) {
      console.warn('Assignment notification failed:', notificationError.message)
    }
  }

  return { data, error }
}

export const getAssignments = async (classId, { role = 'student' } = {}) => {
  const { data, error } = await supabase
    .from('assignments')
    .select('*')
    .eq('class_id', classId)
    .order('created_at', { ascending: false })

  if (error) return { data, error }

  const rows = data || []
  const filtered = role === 'teacher'
    ? rows
    : rows.filter(isStudentVisibleAssignment)

  filtered.sort((a, b) => {
    const left = new Date(assignmentSortDate(a)).getTime()
    const right = new Date(assignmentSortDate(b)).getTime()
    return right - left
  })

  return { data: filtered, error: null }
}

export const deleteAssignment = async (assignmentId) => {
  const { error } = await supabase.from('assignments').delete().eq('id', assignmentId)
  return { error }
}

export const publishAssignmentNow = async (assignmentId) => {
  const { data, error } = await supabase
    .from('assignments')
    .update({ status: 'published', publish_at: null })
    .eq('id', assignmentId)
    .select()
    .single()

  if (error && (isMissingColumnError(error, 'status') || isMissingColumnError(error, 'publish_at'))) {
    return {
      data: null,
      error: { message: 'Publishing controls require the latest assignments schema migration.' },
    }
  }

  return { data, error }
}

export const submitAssignment = async ({ assignmentId, studentId, textContent, file }) => {
  let file_url = null
  let file_name = null

  if (file) {
    const fileExt = file.name.split('.').pop()
    const fileName = `${assignmentId}/${studentId}_${Date.now()}.${fileExt}`

    const { error: uploadError } = await supabase.storage
      .from('submissions')
      .upload(fileName, file)

    if (uploadError) return { error: uploadError }

    const { data: { publicUrl } } = supabase.storage
      .from('submissions')
      .getPublicUrl(fileName)

    file_url = publicUrl
    file_name = file.name
  }

  const { data, error } = await supabase
    .from('assignment_submissions')
    .upsert({
      assignment_id: assignmentId,
      student_id: studentId,
      text_content: textContent || null,
      file_url,
      file_name,
      submitted_at: new Date().toISOString(),
    }, { onConflict: 'assignment_id,student_id' })
    .select()
    .single()

  return { data, error }
}

export const getSubmissions = async (assignmentId) => {
  const { data, error } = await supabase
    .from('assignment_submissions')
    .select('*, profiles(id, full_name, email, student_id)')
    .eq('assignment_id', assignmentId)
    .order('submitted_at', { ascending: false })

  return { data, error }
}

export const getMySubmission = async (assignmentId, studentId) => {
  const { data, error } = await supabase
    .from('assignment_submissions')
    .select('*')
    .eq('assignment_id', assignmentId)
    .eq('student_id', studentId)
    .single()

  return { data, error }
}

export const gradeSubmission = async (submissionId, { score, feedback }) => {
  const { data, error } = await supabase
    .from('assignment_submissions')
    .update({ score, feedback })
    .eq('id', submissionId)
    .select()
    .single()

  return { data, error }
}

export const getStudentAssignmentCount = async (studentId) => {
  const { data: enrollments } = await supabase
    .from('class_enrollments')
    .select('class_id')
    .eq('student_id', studentId)

  if (!enrollments || enrollments.length === 0) return { count: 0 }

  const classIds = enrollments.map((e) => e.class_id)

  const { count } = await supabase
    .from('assignments')
    .select('id', { count: 'exact', head: true })
    .in('class_id', classIds)

  return { count: count || 0 }
}

export const getStudentClassProgress = async (studentId) => {
  const { data: enrollments, error: enrollmentError } = await supabase
    .from('class_enrollments')
    .select('class_id, classes(id, name, subject)')
    .eq('student_id', studentId)

  if (enrollmentError) return { data: [], error: enrollmentError }

  const classRows = (enrollments || [])
    .map((row) => row.classes)
    .filter(Boolean)

  if (classRows.length === 0) return { data: [], error: null }

  const classIds = [...new Set(classRows.map((item) => item.id).filter(Boolean))]

  const [{ data: assignments, error: assignmentsError }, { data: submissions, error: submissionsError }, { data: quizSubmissions, error: quizError }] = await Promise.all([
    supabase
      .from('assignments')
      .select('id, class_id, status, publish_at, created_at')
      .in('class_id', classIds),
    supabase
      .from('assignment_submissions')
      .select('assignment_id')
      .eq('student_id', studentId),
    supabase
      .from('quiz_submissions')
      .select('quiz_id, score, total_points, quizzes(class_id)')
      .eq('student_id', studentId),
  ])

  if (assignmentsError) return { data: [], error: assignmentsError }
  if (submissionsError) return { data: [], error: submissionsError }
  if (quizError) return { data: [], error: quizError }

  const visibleAssignments = (assignments || []).filter(isStudentVisibleAssignment)
  const submittedAssignmentIds = new Set((submissions || []).map((row) => row.assignment_id))

  const assignmentsByClass = visibleAssignments.reduce((acc, assignment) => {
    acc[assignment.class_id] = acc[assignment.class_id] || []
    acc[assignment.class_id].push(assignment)
    return acc
  }, {})

  const quizByClass = (quizSubmissions || []).reduce((acc, row) => {
    const classId = row.quizzes?.class_id
    if (!classId) return acc
    const totalPoints = Number(row.total_points || 0)
    const score = Number(row.score || 0)
    const pct = totalPoints > 0 ? (score / totalPoints) * 100 : 0
    acc[classId] = acc[classId] || []
    acc[classId].push(pct)
    return acc
  }, {})

  const data = classRows.map((cls) => {
    const classAssignments = assignmentsByClass[cls.id] || []
    const totalAssignments = classAssignments.length
    const submittedAssignments = classAssignments.filter((assignment) => submittedAssignmentIds.has(assignment.id)).length
    const pendingAssignments = Math.max(0, totalAssignments - submittedAssignments)
    const completionPct = totalAssignments > 0
      ? Math.round((submittedAssignments / totalAssignments) * 100)
      : 0

    const quizScores = quizByClass[cls.id] || []
    const quizAverage = quizScores.length > 0
      ? Math.round(quizScores.reduce((sum, value) => sum + value, 0) / quizScores.length)
      : null

    return {
      classId: cls.id,
      className: cls.name,
      subject: cls.subject,
      totalAssignments,
      submittedAssignments,
      pendingAssignments,
      completionPct,
      quizAverage,
      quizzesTaken: quizScores.length,
    }
  })

  return { data, error: null }
}

export const getTeacherAssignmentCount = async (teacherId) => {
  const { count, error } = await supabase
    .from('assignments')
    .select('id', { count: 'exact', head: true })
    .eq('teacher_id', teacherId)

  return { count: count || 0, error }
}

export const getStudentLeaderboardRank = async (studentId) => {
  const ASSIGNMENT_WEIGHT = 0.5
  const QUIZ_WEIGHT = 0.5

  const { data: enrollments, error: enrollmentError } = await supabase
    .from('class_enrollments')
    .select('class_id')
    .eq('student_id', studentId)

  if (enrollmentError) return { rank: null, totalStudents: 0, score: 0, error: enrollmentError }
  if (!enrollments || enrollments.length === 0) return { rank: null, totalStudents: 0, score: 0, error: null }

  const classIds = [...new Set(enrollments.map((item) => item.class_id).filter(Boolean))]

  const [
    { data: classmates, error: classmateError },
    { data: assignments, error: assignmentError },
    { data: quizzes, error: quizError },
  ] = await Promise.all([
    supabase
      .from('class_enrollments')
      .select('student_id')
      .in('class_id', classIds),
    supabase
      .from('assignments')
      .select('id, max_points')
      .in('class_id', classIds),
    supabase
      .from('quizzes')
      .select('id, quiz_questions(points)')
      .in('class_id', classIds),
  ])

  if (classmateError) return { rank: null, totalStudents: 0, score: 0, error: classmateError }
  if (assignmentError) return { rank: null, totalStudents: 0, score: 0, error: assignmentError }
  if (quizError) return { rank: null, totalStudents: 0, score: 0, error: quizError }

  const studentIds = [...new Set((classmates || []).map((row) => row.student_id).filter(Boolean))]
  if (studentIds.length === 0) return { rank: null, totalStudents: 0, score: 0, error: null }

  const assignmentIds = (assignments || []).map((row) => row.id)
  const assignmentPointMap = new Map(
    (assignments || []).map((row) => [row.id, Number(row.max_points || 0)])
  )

  const quizIds = (quizzes || []).map((row) => row.id)
  const quizPointMap = new Map(
    (quizzes || []).map((row) => {
      const points = (row.quiz_questions || []).reduce(
        (sum, question) => sum + Number(question.points || 1),
        0
      )
      return [row.id, points]
    })
  )

  let assignmentSubmissions = []
  let quizSubmissions = []

  if (assignmentIds.length > 0) {
    const { data: scoredRows, error: submissionError } = await supabase
      .from('assignment_submissions')
      .select('student_id, assignment_id, score')
      .in('assignment_id', assignmentIds)
      .not('score', 'is', null)

    if (submissionError) return { rank: null, totalStudents: studentIds.length, score: 0, error: submissionError }
    assignmentSubmissions = scoredRows || []
  }

  if (quizIds.length > 0) {
    const { data: quizRows, error: quizSubmissionError } = await supabase
      .from('quiz_submissions')
      .select('student_id, quiz_id, score, total_points')
      .in('quiz_id', quizIds)
      .not('score', 'is', null)

    if (quizSubmissionError) return { rank: null, totalStudents: studentIds.length, score: 0, error: quizSubmissionError }
    quizSubmissions = quizRows || []
  }

  const assignmentEarnedByStudent = new Map(studentIds.map((id) => [id, 0]))
  const quizEarnedByStudent = new Map(studentIds.map((id) => [id, 0]))

  assignmentSubmissions.forEach((row) => {
    if (!assignmentEarnedByStudent.has(row.student_id)) return
    assignmentEarnedByStudent.set(
      row.student_id,
      Number(assignmentEarnedByStudent.get(row.student_id)) + Number(row.score || 0)
    )
  })

  quizSubmissions.forEach((row) => {
    if (!quizEarnedByStudent.has(row.student_id)) return
    quizEarnedByStudent.set(
      row.student_id,
      Number(quizEarnedByStudent.get(row.student_id)) + Number(row.score || 0)
    )
  })

  const totalAssignmentPossible = Array.from(assignmentPointMap.values()).reduce((sum, value) => sum + Number(value || 0), 0)
  const totalQuizPossible = Array.from(quizPointMap.values()).reduce((sum, value) => sum + Number(value || 0), 0)

  const effectiveAssignmentWeight = totalAssignmentPossible > 0 ? ASSIGNMENT_WEIGHT : 0
  const effectiveQuizWeight = totalQuizPossible > 0 ? QUIZ_WEIGHT : 0
  const weightTotal = effectiveAssignmentWeight + effectiveQuizWeight

  const assignmentWeight = weightTotal > 0 ? (effectiveAssignmentWeight / weightTotal) : 1
  const quizWeight = weightTotal > 0 ? (effectiveQuizWeight / weightTotal) : 0

  const leaderboard = studentIds
    .map((id) => {
      const assignmentPct = totalAssignmentPossible > 0
        ? Number(assignmentEarnedByStudent.get(id) || 0) / totalAssignmentPossible
        : 0

      const quizPct = totalQuizPossible > 0
        ? Number(quizEarnedByStudent.get(id) || 0) / totalQuizPossible
        : 0

      const weightedPct = (assignmentPct * assignmentWeight) + (quizPct * quizWeight)
      return {
        id,
        score: Math.round(weightedPct * 10000) / 100,
      }
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return String(a.id).localeCompare(String(b.id))
    })

  const index = leaderboard.findIndex((item) => item.id === studentId)
  const rank = index === -1 ? null : index + 1
  const myScore = index === -1 ? 0 : leaderboard[index].score

  return {
    rank,
    totalStudents: leaderboard.length,
    score: myScore,
    error: null,
  }
}