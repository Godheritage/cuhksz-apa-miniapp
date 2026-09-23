const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

async function ensureCollection(name) {
  try {
    await db.createCollection(name)
  } catch (e) {}
}

function canApplyJoin(user) {
  if (!user) return false
  if (user.appliedAt) return false
  if (user.role === 'member' || user.role === 'admin' || user.role === 'rejected') return false
  if (user.role === 'guest') return true
  if (user.role === 'pending' && !String(user.displayName || '').trim()) return true
  return false
}

function publicUser(user) {
  return {
    _id: user._id,
    displayName: user.displayName || '',
    role: user.role,
    applyNote: user.applyNote || '',
    createdAt: user.createdAt,
    approvedAt: user.approvedAt || null,
    appliedAt: user.appliedAt || null,
    canApply: canApplyJoin(user),
  }
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) {
    return { ok: false, code: 'NO_OPENID', message: '无法识别微信身份' }
  }

  await ensureCollection('users')
  const users = db.collection('users')
  const now = new Date()
  const found = await users.where({ openid: OPENID }).limit(1).get()

  let user
  if (!found.data.length) {
    const doc = {
      openid: OPENID,
      displayName: '',
      role: 'guest',
      applyNote: '',
      createdAt: now,
      updatedAt: now,
    }
    const added = await users.add({ data: doc })
    user = { _id: added._id, ...doc }
  } else {
    user = found.data[0]
    const name = String(user.displayName || '').trim()
    if (user.role === 'pending' && !user.appliedAt && !name) {
      await users.doc(user._id).update({ data: { role: 'guest', updatedAt: now } })
      user.role = 'guest'
    } else if ((user.role === 'pending' || user.role === 'rejected') && !user.appliedAt && name) {
      await users.doc(user._id).update({ data: { appliedAt: user.createdAt || now, updatedAt: now } })
      user.appliedAt = user.createdAt || now
    }
  }

  const admins = await users.where({ role: 'admin' }).limit(1).get()
  if (!admins.data.length && user.role !== 'admin') {
    await users.doc(user._id).update({
      data: {
        role: 'admin',
        approvedAt: now,
        approvedBy: OPENID,
        updatedAt: now,
      },
    })
    user.role = 'admin'
    user.approvedAt = now
  }

  return {
    ok: true,
    data: {
      user: publicUser(user),
    },
  }
}
