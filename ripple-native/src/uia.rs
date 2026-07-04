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

    if name.is_empty() && control_type == "ControlType.Unknown" {
        return Ok(None);
    }

    Ok(Some(A11yFocusedElement {
        name,
        control_type,
        automation_id,
        class_name,
    }))
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
