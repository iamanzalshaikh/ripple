use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct A11yFocusedElement {
    pub name: String,
    #[serde(rename = "controlType")]
    pub control_type: String,
    #[serde(rename = "automationId")]
    pub automation_id: String,
    #[serde(rename = "className")]
    pub class_name: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct A11yNodeSnapshot {
    pub depth: u32,
    pub name: String,
    #[serde(rename = "controlType")]
    pub control_type: String,
    #[serde(rename = "automationId")]
    pub automation_id: String,
    #[serde(rename = "className")]
    pub class_name: String,
    pub value: String,
    #[serde(rename = "hasKeyboardFocus")]
    pub has_keyboard_focus: bool,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct InsertTextA11yDiagnostics {
    #[serde(rename = "windowTitle")]
    pub window_title: String,
    #[serde(rename = "processName")]
    pub process_name: String,
    pub hwnd: i64,
    pub focused: Option<A11yNodeSnapshot>,
    #[serde(rename = "ancestorChain")]
    pub ancestor_chain: Vec<A11yNodeSnapshot>,
    #[serde(rename = "editableElements")]
    pub editable_elements: Vec<A11yNodeSnapshot>,
}

pub fn get_insert_text_a11y_diagnostics() -> Result<InsertTextA11yDiagnostics, String> {
    #[cfg(windows)]
    {
        ensure_com_initialized()?;
        unsafe { read_insert_text_diagnostics() }
    }
    #[cfg(not(windows))]
    {
        Err("windows only".into())
    }
}

pub fn get_focused_a11y_element() -> Result<Option<A11yFocusedElement>, String> {
    #[cfg(windows)]
    {
        ensure_com_initialized()?;
        unsafe { read_focused_element() }
    }
    #[cfg(not(windows))]
    {
        Err("windows only".into())
    }
}

#[cfg(windows)]
fn ensure_com_initialized() -> Result<(), String> {
    use windows::core::HRESULT;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    unsafe {
        const RPC_E_CHANGED_MODE: HRESULT = HRESULT(0x80010106_u32 as i32);
        const S_FALSE: HRESULT = HRESULT(0x00000001_u32 as i32);
        let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
        if hr.is_ok() || hr == RPC_E_CHANGED_MODE || hr == S_FALSE {
            Ok(())
        } else {
            Err(format!("coinitialize_failed:{hr}"))
        }
    }
}

#[cfg(windows)]
unsafe fn read_focused_element() -> Result<Option<A11yFocusedElement>, String> {
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
    use windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation};

    let automation: IUIAutomation =
        CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
            .map_err(|e| format!("uia_create_failed:{e}"))?;

    let element = automation
        .GetFocusedElement()
        .map_err(|e| format!("uia_focus_failed:{e}"))?;

    let name = bstr_to_string(element.CurrentName().ok());
    let control_type = element
        .CurrentControlType()
        .map(control_type_programmatic_name)
        .unwrap_or_else(|_| "ControlType.Unknown".to_string());
    let automation_id = bstr_to_string(element.CurrentAutomationId().ok());
    let class_name = bstr_to_string(element.CurrentClassName().ok());
    let value = read_element_value(&element);

    if name.is_empty() && control_type == "ControlType.Unknown" {
        return Ok(None);
    }

    Ok(Some(A11yFocusedElement {
        name,
        control_type,
        automation_id,
        class_name,
        value,
    }))
}

#[cfg(windows)]
fn read_element_value(element: &windows::Win32::UI::Accessibility::IUIAutomationElement) -> String {
    use windows::Win32::UI::Accessibility::{IUIAutomationValuePattern, UIA_ValuePatternId};

    unsafe {
        if let Ok(pattern) = element.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
        {
            if let Ok(val) = pattern.CurrentValue() {
                return bstr_to_string(Some(val));
            }
        }
    }
    String::new()
}

#[cfg(windows)]
fn bstr_to_string(value: Option<windows::core::BSTR>) -> String {
    value
        .map(|b| b.to_string())
        .unwrap_or_default()
        .chars()
        .filter(|c| !c.is_control())
        .collect::<String>()
        .trim()
        .to_string()
}

#[cfg(windows)]
fn control_type_programmatic_name(
    id: windows::Win32::UI::Accessibility::UIA_CONTROLTYPE_ID,
) -> String {
    use windows::Win32::UI::Accessibility::*;

    let label = match id {
        UIA_ButtonControlTypeId => "Button",
        UIA_CalendarControlTypeId => "Calendar",
        UIA_CheckBoxControlTypeId => "CheckBox",
        UIA_ComboBoxControlTypeId => "ComboBox",
        UIA_EditControlTypeId => "Edit",
        UIA_HyperlinkControlTypeId => "Hyperlink",
        UIA_ImageControlTypeId => "Image",
        UIA_ListItemControlTypeId => "ListItem",
        UIA_ListControlTypeId => "List",
        UIA_MenuControlTypeId => "Menu",
        UIA_MenuBarControlTypeId => "MenuBar",
        UIA_MenuItemControlTypeId => "MenuItem",
        UIA_ProgressBarControlTypeId => "ProgressBar",
        UIA_RadioButtonControlTypeId => "RadioButton",
        UIA_ScrollBarControlTypeId => "ScrollBar",
        UIA_SliderControlTypeId => "Slider",
        UIA_SpinnerControlTypeId => "Spinner",
        UIA_StatusBarControlTypeId => "StatusBar",
        UIA_TabControlTypeId => "Tab",
        UIA_TabItemControlTypeId => "TabItem",
        UIA_TextControlTypeId => "Text",
        UIA_ToolBarControlTypeId => "ToolBar",
        UIA_ToolTipControlTypeId => "ToolTip",
        UIA_TreeControlTypeId => "Tree",
        UIA_TreeItemControlTypeId => "TreeItem",
        UIA_CustomControlTypeId => "Custom",
        UIA_GroupControlTypeId => "Group",
        UIA_ThumbControlTypeId => "Thumb",
        UIA_DataGridControlTypeId => "DataGrid",
        UIA_DataItemControlTypeId => "DataItem",
        UIA_DocumentControlTypeId => "Document",
        UIA_SplitButtonControlTypeId => "SplitButton",
        UIA_WindowControlTypeId => "Window",
        UIA_PaneControlTypeId => "Pane",
        UIA_HeaderControlTypeId => "Header",
        UIA_HeaderItemControlTypeId => "HeaderItem",
        UIA_TableControlTypeId => "Table",
        UIA_TitleBarControlTypeId => "TitleBar",
        UIA_SeparatorControlTypeId => "Separator",
        UIA_SemanticZoomControlTypeId => "SemanticZoom",
        UIA_AppBarControlTypeId => "AppBar",
        other => return format!("ControlType.Unknown({})", other.0),
    };

    format!("ControlType.{label}")
}

#[cfg(windows)]
fn is_editable_control_type(control_type: &str) -> bool {
    let c = control_type.to_lowercase();
    c.contains("edit") || c.contains("document") || c.contains("text")
}

#[cfg(windows)]
unsafe fn snapshot_element(
    element: &windows::Win32::UI::Accessibility::IUIAutomationElement,
    depth: u32,
) -> A11yNodeSnapshot {
    let name = bstr_to_string(element.CurrentName().ok());
    let control_type = element
        .CurrentControlType()
        .map(control_type_programmatic_name)
        .unwrap_or_else(|_| "ControlType.Unknown".to_string());
    let automation_id = bstr_to_string(element.CurrentAutomationId().ok());
    let class_name = bstr_to_string(element.CurrentClassName().ok());
    let value = read_element_value(element);
    let has_keyboard_focus = element
        .CurrentHasKeyboardFocus()
        .map(|b| b.as_bool())
        .unwrap_or(false);
    let enabled = element
        .CurrentIsEnabled()
        .map(|b| b.as_bool())
        .unwrap_or(false);

    A11yNodeSnapshot {
        depth,
        name,
        control_type,
        automation_id,
        class_name,
        value,
        has_keyboard_focus,
        enabled,
    }
}

#[cfg(windows)]
unsafe fn read_insert_text_diagnostics(
) -> Result<InsertTextA11yDiagnostics, String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, TreeScope_Descendants,
    };

    let fg = crate::foreground::read_current_foreground()
        .ok_or_else(|| "no_foreground".to_string())?;

    let automation: IUIAutomation =
        CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
            .map_err(|e| format!("uia_create_failed:{e}"))?;

    let focused_el = automation
        .GetFocusedElement()
        .map_err(|e| format!("uia_focus_failed:{e}"))?;
    let focused = Some(snapshot_element(&focused_el, 0));

    let mut ancestor_chain = Vec::new();
    let walker = automation
        .RawViewWalker()
        .map_err(|e| format!("uia_walker_failed:{e}"))?;
    let mut current = focused_el;
    for depth in 1..=12 {
        let parent = match walker.GetParentElement(&current) {
            Ok(p) => p,
            Err(_) => break,
        };
        ancestor_chain.push(snapshot_element(&parent, depth));
        current = parent;
    }

    let mut editable_elements = Vec::new();
    let hwnd = HWND(fg.hwnd as *mut _);
    if let Ok(root) = automation.ElementFromHandle(hwnd) {
        if let Ok(true_cond) = automation.CreateTrueCondition() {
            if let Ok(found) = root.FindAll(TreeScope_Descendants, &true_cond) {
                let len = found.Length().unwrap_or(0);
                let scan_cap = len.min(250);
                for i in 0..scan_cap {
                    if editable_elements.len() >= 40 {
                        break;
                    }
                    if let Ok(el) = found.GetElement(i) {
                        let snap = snapshot_element(&el, 0);
                        if is_editable_control_type(&snap.control_type) {
                            editable_elements.push(snap);
                        }
                    }
                }
            }
        }
    }

    Ok(InsertTextA11yDiagnostics {
        window_title: fg.window_title,
        process_name: fg.process_name,
        hwnd: fg.hwnd,
        focused,
        ancestor_chain,
        editable_elements,
    })
}
