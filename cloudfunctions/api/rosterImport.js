'use strict'

const board = require('./roster922.json')

function insuranceLine(row) {
  const bits = ['自费保险']
  if (row.birthday) bits.push('生日 ' + row.birthday)
  if (row.insuredOn) bits.push('投保 ' + row.insuredOn)
  if (row.payer) bits.push('投保人 ' + row.payer)
  return bits.join(' · ')
}

function creditEvents(source) {
  const data = source || board
  return (data.credits || []).map((row) => ({
    openid: '',
    workerName: row.workerName,
    taskId: row.key,
    title: row.title,
    dateKey: row.dateKey,
    at: Date.parse(row.dateKey + 'T12:00:00+08:00') || 0,
  }))
}

function storedBoard(source) {
  const data = source || board
  return {
    key: data.key,
    label: data.label,
    through: data.through,
    feedRule: data.feedRule,
    duty: data.duty || [],
    feed: data.feed || [],
    credits: data.credits || [],
    insurance: data.insurance || [],
  }
}

function boardView(source) {
  const data = storedBoard(source)
  return {
    label: data.label,
    through: data.through,
    feedRule: data.feedRule,
    duty: data.duty,
    feed: data.feed,
    counts: {
      duty: data.duty.length,
      feed: data.feed.length,
      credits: data.credits.length,
      insurance: data.insurance.length,
    },
  }
}

module.exports = {
  board,
  insuranceLine,
  creditEvents,
  storedBoard,
  boardView,
}
