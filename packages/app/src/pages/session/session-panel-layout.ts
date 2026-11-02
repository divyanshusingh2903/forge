export function sessionPanelLayout(input: {
  review: boolean
  browser?: boolean
  terminal: boolean
  files: boolean
}) {
  const browser = input.browser ?? false
  return {
    visible: input.review || browser || input.terminal || input.files,
    stacked: (input.review || browser) && input.terminal,
  }
}

export function resolveRightPanelToggle(
  current: { review: boolean; browser: boolean; files?: boolean },
  action: { type: "review"; open: boolean } | { type: "browser"; open: boolean; auto?: boolean },
) {
  if (action.type === "review") {
    return {
      review: action.open,
      browser: action.open ? false : current.browser,
      activity: false,
    }
  }
  if (action.auto) {
    if (current.review || current.files) {
      return {
        review: current.review,
        browser: current.browser,
        activity: !current.browser,
      }
    }
    return {
      review: false,
      browser: action.open,
      activity: false,
    }
  }
  return {
    review: action.open ? false : current.review,
    browser: action.open,
    activity: false,
  }
}
