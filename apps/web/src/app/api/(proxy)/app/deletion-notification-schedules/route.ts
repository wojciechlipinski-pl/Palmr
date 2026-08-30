import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3333";

async function proxy(req: NextRequest, method: "GET" | "PUT") {
  const cookieHeader = req.headers.get("cookie");
  const url = `${API_BASE_URL}/app/deletion-notification-schedules`;
  const body = method === "PUT" ? await req.text() : undefined;

  const apiRes = await fetch(url, {
    method,
    headers: {
      cookie: cookieHeader || "",
      "Content-Type": "application/json",
    },
    body,
    redirect: "manual",
  });

  const resBody = await apiRes.text();
  const res = new NextResponse(resBody, {
    status: apiRes.status,
    headers: {
      "Content-Type": "application/json",
    },
  });

  const setCookie = apiRes.headers.getSetCookie?.() || [];
  if (setCookie.length > 0) {
    res.headers.set("Set-Cookie", setCookie.join(","));
  }

  return res;
}

export async function GET(req: NextRequest) {
  return proxy(req, "GET");
}

export async function PUT(req: NextRequest) {
  return proxy(req, "PUT");
}
