import { RegisterForm } from "@/components/RegisterForm";
export default function Page() {
  return (<main className="mx-auto max-w-sm px-4 py-16"><h1 className="text-2xl font-semibold">Patient registration</h1><RegisterForm type="patient" /></main>);
}
