// TH dictionary (field fragmentation, key = Chinese original text). Data files are exempt from the upper limit of row count.
// Source: src/editor/types.ts UI label of top-level constant.
export default {
  // ZOOM_SHAPE_LABELS
  'Punch': 'พันช์',
  'Push & Pull Back': 'ดันเข้าแล้วดึงกลับ',
  'Slow Push': 'ดันช้า',
  'Instant': 'ฉับพลัน',
  'Zoom Out': 'ซูมออก',
  'Ease-In Push': 'ดันเข้าแบบ Ease-In',
  'Bouncy Push': 'ดันเข้าแบบเด้ง',
  'Snap Push': 'ดันเข้าแบบสแนป',
  'Pulse': 'พัลส์',
  'Whip-In Push': 'วิปอินแล้วดันเข้า',
  // TRANSITION_LABELS
  'Anticipation Zoom': 'ซูมคาดการณ์',
  'Clean Line Wipe': 'ปัดเส้นขาว',
  'Cross Dissolve': 'ครอสดิสโซล์ฟ',
  'Dip to Black': 'เฟดดำ',
  'Flash': 'แฟลชขาว',
  'Impact Shake': 'กระแทกสั่น',
  'Luma Blend': 'ลูมาเบลนด์',
  'Organic Dissolve': 'ดิสโซล์ฟนุ่ม',
  'Page Curl': 'พลิกหน้า',
  'Rack Focus': 'แร็กโฟกัส',
  'Soft Wipe': 'ปัดนุ่ม',
  'Whip Pan': 'วิปแพน',
  'Circle Wipe': 'ปัดวงกลม',
  'Voice isolation failed; no clips were modified.': 'แยกเสียงพูดไม่สำเร็จ ไม่ได้แก้คลิปใด',
  'Loudness analysis failed; no clips were modified.': 'วิเคราะห์ความดังไม่สำเร็จ ไม่ได้แก้คลิปใด',
  'Source media changed; the previous voice separation result was discarded. Retry.': 'แหล่งมีเดียของคลิปเปลี่ยนแล้ว ผลแยกเสียงพูดเดิมถูกทิ้ง ลองใหม่',
} as Record<string, string>;
