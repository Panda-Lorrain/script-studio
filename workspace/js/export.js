// workspace/js/export.js（占位，Task 9 替换）
// 占位版导出所有被引用的名字，避免其他模块 import 报错
import * as utils from './utils.js';

export async function exportProject(data) {
  utils.toast('导出功能待实现（Task 9）');
}
export async function importJSONFile(file) {
  throw new Error('导入功能待实现（Task 9）');
}
export function exportShotList(data, assets) {
  utils.toast('生图清单待实现（Task 9）');
}
export function exportCutGuide(data) {
  utils.toast('剪辑指引待实现（Task 9）');
}
