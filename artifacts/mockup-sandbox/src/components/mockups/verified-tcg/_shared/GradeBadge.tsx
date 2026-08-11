import React from "react";
export function GradeBadge({ grade, grader }: { grade: string; grader: string }) {
  return <div className={`rounded-sm border-2 ${grader === "BGS" ? "border-amber-300" : "border-red-500"} bg-zinc-50 px-1.5 py-1 text-center text-[9px] font-black leading-none text-zinc-900 shadow-lg`}><div className={`text-[8px] ${grader === "BGS" ? "text-amber-700" : "text-red-600"}`}>{grader} |</div><div className="text-sm">{grade.replace(`${grader} `, "")}</div></div>;
}