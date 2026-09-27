// Timeline: the rounds of a session (prompt, answer, edits) from the Claude transcript, see server/transcript.py.
module.exports = ({ ipcMain, transcript }) => {
  ipcMain.handle('timeline:rounds', async (_e, id) => JSON.parse((await transcript(id, 'rounds')) || '[]'));
};
